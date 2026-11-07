import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { GitHubTracker } from "./github.ts";
import { VIEWER } from "./ops.ts";

export const START = "<!-- gam:start -->";
export const END = "<!-- gam:end -->";
/** Until there is an npm release, install straight from GitHub. */
export const COMMAND = ["npx", "-y", "github:CocoRoF/git-agent-manager", "mcp"];

function has(cmd: string): boolean {
  return spawnSync(cmd, ["--version"], { stdio: "ignore", timeout: 15_000 }).status === 0;
}

function viaCli(cmd: string, addArgs: string[]): "added" | "already" | "failed" {
  if (spawnSync(cmd, ["mcp", "get", "gam"], { stdio: "ignore", timeout: 15_000 }).status === 0) return "already";
  return spawnSync(cmd, addArgs, { stdio: "ignore", timeout: 30_000 }).status === 0 ? "added" : "failed";
}

function viaJson(path: string): "added" | "already" | "failed" {
  try {
    const config = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    if (config.mcpServers?.gam) return "already";
    config.mcpServers = { ...config.mcpServers, gam: { command: COMMAND[0], args: COMMAND.slice(1) } };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
    return "added";
  } catch {
    // A config we can't parse is the user's. Leave it alone.
    return "failed";
  }
}

/** For agents that read instruction files but not MCP's instructions. It applies to every repo, so it has to be safe with no plan. */
export const GLOBAL_POINTER = `${START}
Before starting work in a git repo, call \`gam_status\` once. If it reports a plan, do the work through \`gam_claim\`, \`gam_update\` and \`gam_finish\`, one task at a time, and follow the \`next:\` line in each result. For a small job outside the plan, call \`gam_claim\` with \`new\` before changing anything. If there's no plan, carry on as usual.
${END}`;

/** Replaces our block in an instruction file, or adds it at the end. */
export function withPointer(text: string, pointer: string): string {
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  if (a !== -1 && b > a) return text.slice(0, a) + pointer + text.slice(b + END.length);
  return text.trim() ? `${text.trimEnd()}\n\n${pointer}\n` : `${pointer}\n`;
}

function viaInstructions(path: string): "added" | "already" | "failed" {
  try {
    const cur = existsSync(path) ? readFileSync(path, "utf8") : "";
    const next = withPointer(cur, GLOBAL_POINTER);
    if (next === cur) return "already";
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, next);
    return "added";
  } catch {
    return "failed";
  }
}

export interface AgentResult {
  agent: string;
  result: "added" | "already" | "failed";
}

/** Registers with every agent on this machine at user level, so each repo needs no setup of its own. */
export function connectAgents(home = homedir()): AgentResult[] {
  const out: AgentResult[] = [];
  if (has("claude")) {
    out.push({ agent: "Claude Code", result: viaCli("claude", ["mcp", "add", "--scope", "user", "gam", "--", ...COMMAND]) });
    out.push({ agent: "Claude Code hooks", result: installHooks(home) });
  }
  if (has("codex")) {
    out.push({ agent: "Codex", result: viaCli("codex", ["mcp", "add", "gam", "--", ...COMMAND]) });
    // Measured: without this, Codex almost never calls the tools. See docs/BENCHMARK.md.
    out.push({ agent: "Codex instructions", result: viaInstructions(join(process.env.CODEX_HOME || join(home, ".codex"), "AGENTS.md")) });
  }
  if (existsSync(join(home, ".cursor"))) out.push({ agent: "Cursor", result: viaJson(join(home, ".cursor", "mcp.json")) });
  if (existsSync(join(home, ".gemini"))) {
    out.push({ agent: "Gemini", result: viaJson(join(home, ".gemini", "settings.json")) });
    out.push({ agent: "Gemini instructions", result: viaInstructions(join(home, ".gemini", "GEMINI.md")) });
  }
  return out;
}

export function statusImage(owner: string, repo: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/refs/gam/status/status.svg`;
}

export function readmeBlock(owner: string, repo: string, isPrivate: boolean): string {
  const view = `${VIEWER}#/${owner}/${repo}`;
  const plan = `https://github.com/${owner}/${repo}/milestones`;
  // An anonymous image request can't read a private repo, so those get links only.
  const lines = isPrivate
    ? [`**Plan:** [dashboard](${view}) · [milestones](${plan})`]
    : [`[![Plan progress](${statusImage(owner, repo)})](${view})`];
  return [START, ...lines, END].join("\n");
}

/** Adds our hooks to Claude Code's settings. Returns null when there's nothing to change. */
export function withHooks(settings: any, command: string): any | null {
  const events: [string, string][] = [["SessionStart", "session-start"], ["Stop", "stop"]];
  const next = structuredClone(settings);
  next.hooks ??= {};
  let changed = false;
  for (const [event, name] of events) {
    const list: any[] = (next.hooks[event] ??= []);
    const mine = list.flatMap((g) => g.hooks ?? []).find((h: any) => /git-agent-manager/.test(h.command ?? "") && h.command.endsWith(`hook ${name}`));
    const wanted = `${command} hook ${name}`;
    if (mine?.command === wanted) continue;
    if (mine) mine.command = wanted;
    else list.push({ hooks: [{ type: "command", command: wanted, timeout: 15 }] });
    changed = true;
  }
  return changed ? next : null;
}

/**
 * Hooks run at every turn, and npx costs seconds each time, so they use a local copy of this
 * program. Running connect again refreshes it.
 */
function installHooks(home: string): "added" | "already" | "failed" {
  const script = process.argv[1];
  if (!script) return "failed";
  try {
    const dir = process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, "git-agent-manager") : join(home, ".local", "share", "git-agent-manager");
    mkdirSync(dir, { recursive: true });
    const copy = join(dir, "cli.js");
    copyFileSync(script, copy);
    chmodSync(copy, 0o755);
    writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');

    const path = join(process.env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "settings.json");
    const settings = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    const next = withHooks(settings, `node "${copy}"`);
    if (!next) return "already";
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
    return "added";
  } catch {
    // Settings we can't parse are the user's. Leave them alone.
    return "failed";
  }
}

/** Replaces the existing block, or puts a new one right after the title. */
export function withBlock(readme: string, block: string): string {
  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a !== -1 && b > a) return readme.slice(0, a) + block + readme.slice(b + END.length);
  const lines = readme.split("\n");
  const title = lines.findIndex((l) => /^#\s/.test(l));
  if (title === -1) return `${block}\n\n${readme}`;
  lines.splice(title + 1, 0, "", block, ...(lines[title + 1]?.trim() ? [""] : []));
  return lines.join("\n");
}

export const POINTER = `${START}
This repo plans its work with git-agent-manager. Call \`gam_status\` before starting, and do the work through \`gam_claim\`, \`gam_update\` and \`gam_finish\`. Without those tools, run \`npx -y github:CocoRoF/git-agent-manager status\`.
${END}`;

export const WORKFLOW = `name: Plan
on:
  issues:
    types: [opened, closed, reopened, milestoned, demilestoned, labeled, unlabeled]
  milestone:
    types: [created, edited, closed, opened, deleted]
  pull_request:
    types: [opened, edited, reopened, closed, synchronize]
permissions:
  contents: write
  issues: read
  pull-requests: read
concurrency:
  group: gam-\${{ github.event.pull_request.number || 'status' }}
  cancel-in-progress: true
jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      - uses: CocoRoF/git-agent-manager@v0
`;

export interface RepoFiles {
  readme: boolean;
  workflow: boolean;
  pointer: boolean;
}

/** Proposes the optional repo files as one PR, without touching the local checkout. */
export async function proposeRepoFiles(t: GitHubTracker, isPrivate: boolean, files: RepoFiles): Promise<string | null> {
  const branch = "git-agent-manager/connect";
  const base = await t.branchFromDefault(branch);
  let changed = false;
  if (files.readme) {
    const cur = await t.readFile(`README.md`);
    const next = withBlock(cur?.text ?? `# ${t.repo}\n`, readmeBlock(t.owner, t.repo, isPrivate));
    if (next !== cur?.text) {
      await t.writeFile("README.md", next, branch, "Show plan progress in the README", cur?.sha);
      changed = true;
    }
  }
  if (files.pointer) {
    const cur = await t.readFile("AGENTS.md");
    const next = withBlock(cur?.text ?? "# Agents\n", POINTER);
    if (next !== cur?.text) {
      await t.writeFile("AGENTS.md", next, branch, "Point agents at the plan", cur?.sha);
      changed = true;
    }
  }
  if (files.workflow && !isPrivate) {
    const path = ".github/workflows/gam.yml";
    const cur = await t.readFile(path);
    if (!cur) {
      await t.writeFile(path, WORKFLOW, branch, "Keep plan progress up to date on merge", undefined);
      changed = true;
    }
  }
  if (!changed) {
    await t.deleteBranch(branch);
    return null;
  }
  const pull = await t.createPull({
    title: "Connect git-agent-manager",
    head: branch,
    body: `Adds plan progress to this repo. All of it is optional, and nothing else in the repo changes.\n\nThe plan itself lives in this repo's [Milestones](https://github.com/${t.owner}/${t.repo}/milestones) and Issues.\n\n<sub>Base: ${base}</sub>`,
  });
  return pull.url;
}
