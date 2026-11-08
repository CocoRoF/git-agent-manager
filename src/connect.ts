import { spawnSync } from "node:child_process";
import type { GitHubTracker } from "./github.ts";

export const START = "<!-- gam:start -->";
export const END = "<!-- gam:end -->";
export const COMMAND = ["npx", "-y", "git-agent-manager", "mcp"];

export function statusImage(owner: string, repo: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/refs/gam/status/status.svg`;
}

export function readmeBlock(owner: string, repo: string, isPrivate: boolean, dashboard: string | null): string {
  const target = dashboard ?? `https://github.com/${owner}/${repo}/milestones`;
  // An anonymous image request can't read a private repo, so those get links only.
  const lines = isPrivate
    ? [`**Plan:** ${dashboard ? `[dashboard](${dashboard}) · ` : ""}[milestones](https://github.com/${owner}/${repo}/milestones)`]
    : [`[![Plan progress](${statusImage(owner, repo)})](${target})`];
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
  lines.splice(title + 1, 0, "", block, ...(lines[title + 1]?.trim() ? [""] : []));
  return lines.join("\n");
}

export const POINTER = `${START}
This repo plans its work with git-agent-manager. Call \`gam_status\` before starting, then do the work through \`gam_claim\`, \`gam_update\` and \`gam_finish\`, one task at a time, following the \`next:\` line in each result. For a small job outside the plan, call \`gam_claim\` with \`new\` before changing anything. Without those tools, run \`npx -y git-agent-manager status\`.
${END}`;

/** Project-level MCP config for Claude Code, keeping the repo's other servers. */
export function withMcpJson(text: string | null): string | null {
  const config = text ? JSON.parse(text) : {};
  if (config.mcpServers?.gam) return null;
  config.mcpServers = { ...config.mcpServers, gam: { command: COMMAND[0], args: COMMAND.slice(1) } };
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** Project-level MCP config for Codex. Appends a table rather than parsing TOML. */
export function withCodexToml(text: string | null): string | null {
  if (text && /^\[mcp_servers\.gam\]/m.test(text)) return null;
  const table = `[mcp_servers.gam]\ncommand = "${COMMAND[0]}"\nargs = [${COMMAND.slice(1).map((a) => `"${a}"`).join(", ")}]\n`;
  return text?.trim() ? `${text.trimEnd()}\n\n${table}` : table;
}

/** Points links at the repo's own dashboard. Keeps every other setting. */
export function withDashboard(text: string | null, url: string): string | null {
  const line = `dashboard: ${url}`;
  if (!text?.trim()) return `${line}\n`;
  if (/^dashboard:/m.test(text)) return text.replace(/^dashboard:.*$/m, line) === text ? null : text.replace(/^dashboard:.*$/m, line);
  return `${text.trimEnd()}\n${line}\n`;
}

/** The repo's workflow. With a dashboard, a push to the default branch also deploys it to the repo's own Pages. */
export function workflow(defaultBranch: string, dashboard: boolean): string {
  const events = `on:
  issues:
    types: [opened, closed, reopened, milestoned, demilestoned, labeled, unlabeled]
  milestone:
    types: [created, edited, closed, opened, deleted]
  pull_request:
    types: [opened, edited, reopened, closed, synchronize]${
      dashboard
        ? `
  push:
    branches: [${JSON.stringify(defaultBranch)}]
  workflow_dispatch:`
        : ""
    }`;
  const plan = `  plan:${dashboard ? `\n    if: github.event_name != 'push' && github.event_name != 'workflow_dispatch'` : ""}
    runs-on: ubuntu-latest
    steps:
      - uses: CocoRoF/git-agent-manager@v0`;
  const site = `
  dashboard:
    if: github.event_name == 'push' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: \${{ steps.deploy.outputs.page_url }}
    steps:
      - uses: CocoRoF/git-agent-manager@v0
        with:
          site: _site
      - uses: actions/upload-pages-artifact@v4
        with:
          path: _site
      - id: deploy
        uses: actions/deploy-pages@v4`;
  return `name: Plan
${events}
permissions:
  contents: write
  issues: read
  pull-requests: read
concurrency:
  group: gam-\${{ github.event.pull_request.number || github.event_name }}
  cancel-in-progress: true
jobs:
${plan}${dashboard ? site : ""}
`;
}

export type PagesResult = { url: string } | { reason: string };

/**
 * Sets up the repo's own GitHub Pages for the dashboard, unless the repo already uses Pages
 * for something else. A repo has only one Pages site, and it isn't ours to take.
 */
export async function setUpPages(t: GitHubTracker): Promise<PagesResult> {
  const pages = await t.getPages();
  if (pages && pages.buildType !== "workflow") return { reason: "this repo's GitHub Pages already serves a site from a branch" };
  if (pages) {
    const other = (await t.listWorkflows()).filter((w) => w.path !== ".github/workflows/gam.yml" && /deploy-pages/.test(w.text));
    if (other.length) return { reason: `this repo's GitHub Pages already serves a site, from ${other.map((w) => w.path).join(", ")}` };
    return { url: pages.url };
  }
  const created = await t.enablePages();
  return created ? { url: created } : { reason: "GitHub didn't let this login turn on Pages. That takes admin access, and a paid plan for private repos" };
}

export interface RepoFiles {
  readme: boolean;
  workflow: boolean;
  /** .mcp.json, .codex/config.toml and the AGENTS.md pointer, so every agent working in the repo is connected. */
  agents: boolean;
}

/** Proposes the repo's files as one PR, without touching the local checkout. */
export async function proposeRepoFiles(
  t: GitHubTracker,
  repo: { private: boolean; defaultBranch: string },
  dashboard: string | null,
  files: RepoFiles,
): Promise<{ url: string; changed: string[]; open?: boolean } | null> {
  const branch = "git-agent-manager/connect";
  // An earlier run's pull request is still waiting. Leave it as it is.
  const waiting = await t.openPullFrom(branch);
  if (waiting) return { url: waiting.url, changed: [], open: true };
  await t.branchFromDefault(branch);
  const changed: string[] = [];
  const put = async (path: string, next: (cur: string | null) => string | null, message: string) => {
    const cur = await t.readFile(path, branch);
    const text = next(cur?.text ?? null);
    if (text === null || text === cur?.text) return;
    await t.writeFile(path, text, branch, message, cur?.sha);
    changed.push(path);
  };
  if (files.agents) {
    await put(".mcp.json", withMcpJson, "Connect Claude Code to the plan");
    await put(".codex/config.toml", withCodexToml, "Connect Codex to the plan");
    await put("AGENTS.md", (cur) => withBlock(cur ?? "# Agents\n", POINTER), "Point agents at the plan");
  }
  if (dashboard) await put(".github/gam.yml", (cur) => withDashboard(cur, dashboard), "Point plan links at this repo's dashboard");
  if (files.readme) await put("README.md", (cur) => withBlock(cur ?? `# ${t.repo}\n`, readmeBlock(t.owner, t.repo, repo.private, dashboard)), "Show plan progress in the README");
  // Actions minutes cost money on private repos, and their image can't be shown anyway.
  if (files.workflow && !repo.private) {
    await put(".github/workflows/gam.yml", (cur) => (cur && cur.includes("CocoRoF/git-agent-manager@") && (!dashboard || cur.includes("site:")) ? null : workflow(repo.defaultBranch, !!dashboard)), "Keep plan progress up to date");
  }
  if (!changed.length) {
    await t.deleteBranch(branch);
    return null;
  }
  const pull = await t.createPull({
    title: "Connect git-agent-manager",
    head: branch,
    body: [
      `Connects this repo to its plan. Agents that work here plan and track their work in this repo's [Milestones](https://github.com/${t.owner}/${t.repo}/milestones) and Issues.`,
      ...(dashboard ? ["", `The dashboard is served from this repo's own GitHub Pages: ${dashboard}`] : []),
      "",
      ...changed.map((f) => `- \`${f}\``),
    ].join("\n"),
  });
  return { url: pull.url, changed };
}

/** Registers the MCP server for this clone only, so Claude Code works here before the PR lands. */
export function connectLocal(root: string): "added" | "already" | "missing" | "failed" {
  if (spawnSync("claude", ["--version"], { stdio: "ignore", timeout: 15_000 }).status !== 0) return "missing";
  if (spawnSync("claude", ["mcp", "get", "gam"], { cwd: root, stdio: "ignore", timeout: 15_000 }).status === 0) return "already";
  const r = spawnSync("claude", ["mcp", "add", "--scope", "local", "gam", "--", ...COMMAND], { cwd: root, stdio: "ignore", timeout: 30_000 });
  return r.status === 0 ? "added" : "failed";
}
