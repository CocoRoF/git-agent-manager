import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

export interface AgentResult {
  agent: string;
  result: "added" | "already" | "failed";
}

/** Registers with every agent on this machine at user level, so each repo needs no setup of its own. */
export function connectAgents(home = homedir()): AgentResult[] {
  const out: AgentResult[] = [];
  if (has("claude")) out.push({ agent: "Claude Code", result: viaCli("claude", ["mcp", "add", "--scope", "user", "gam", "--", ...COMMAND]) });
  if (has("codex")) out.push({ agent: "Codex", result: viaCli("codex", ["mcp", "add", "gam", "--", ...COMMAND]) });
  if (existsSync(join(home, ".cursor"))) out.push({ agent: "Cursor", result: viaJson(join(home, ".cursor", "mcp.json")) });
  if (existsSync(join(home, ".gemini"))) out.push({ agent: "Gemini", result: viaJson(join(home, ".gemini", "settings.json")) });
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

/** Replaces the existing block, or puts a new one right after the title. */
export function withBlock(readme: string, block: string): string {
  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a !== -1 && b > a) return readme.slice(0, a) + block + readme.slice(b + END.length);
  const lines = readme.split("\n");
  const title = lines.findIndex((l) => /^#\s/.test(l));
  if (title === -1) return `${block}\n\n${readme}`;
  lines.splice(title + 1, 0, "", block);
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
