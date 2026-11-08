import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { connectLocal, proposeRepoFiles, setUpPages } from "./connect.ts";
import { dashboardHtml, siteHtml } from "./dashboard.ts";
import { GitHubTracker } from "./github.ts";
import { runHook } from "./hooks.ts";
import { currentBranch, detectRepo, findToken, repoRoot } from "./local.ts";
import { parseSlug, serveMcp, toPlan } from "./mcp.ts";
import { refreshStatus } from "./svg.ts";
import { OpError, agenda, block, claim, finish, format, plan, status, update, type Ctx, type Result } from "./ops.ts";

declare const __VERSION__: string;
declare const __VIEWER_HTML__: string;
const VERSION = typeof __VERSION__ === "string" ? __VERSION__ : "dev";

const HELP = `git-agent-manager ${VERSION}

  npx git-agent-manager                         connect the repo in this folder

  gam status                                    where the plan stands
  gam agenda <text>                             hand agents a goal to plan and carry out
  gam plan <file.json | ->                      create or extend the plan
  gam claim [issue] [--new title] [--takeover]  take a task
  gam update [issue] <note> [--unblock]         add a line of progress
  gam finish [issue] --evidence text [--met 1,2] [--no-code] [--merge]
  gam block [issue] <reason>
  gam dashboard [--out file.html]               write the dashboard to a file and open it
  gam site <folder> [--repos a/b,c/d]           a dashboard to host on your own domain
  gam mcp                                       run the MCP server

  --repo owner/name   use this repo instead of the current folder's origin
  --agents-md         connect: also add an AGENTS.md pointer, for teammates and cloud agents
  --json              print machine-readable output
  GAM_AGENT           the name this agent signs its work with
  GAM_ROLE            prefer tasks with this role:* label`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function tracker(slug?: string): GitHubTracker {
  const found = slug ? parseSlug(slug) : detectRepo();
  if (!found) fail(repoRoot() ? "This repo has no GitHub origin remote." : "This isn't a git repo. Run gam inside a GitHub repo's folder.");
  const token = findToken();
  if (!token) fail("No GitHub login found. Run `gh auth login`, or set GITHUB_TOKEN.");
  return new GitHubTracker(found.owner, found.repo, token);
}

async function ask(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [Y/n] `)).trim().toLowerCase();
  rl.close();
  return answer === "" || answer === "y" || answer === "yes";
}

async function connect(values: { yes?: boolean; repo?: string }): Promise<void> {
  if (values.repo) fail("connect works on the repo in the current folder. Run it inside that repo, without --repo.");
  const root = repoRoot();
  if (!root) fail("This isn't a git repo. git-agent-manager connects one repo at a time, so run this inside the repo's folder.");
  const found = detectRepo(root);
  if (!found) fail("This repo has no GitHub origin remote. git-agent-manager works with repos on GitHub.");
  const token = findToken();
  if (!token) fail("No GitHub login found. Run `gh auth login`, or set GITHUB_TOKEN, then run this again.");
  const t = new GitHubTracker(found.owner, found.repo, token);
  const slug = `${found.owner}/${found.repo}`;
  const s = await t.snapshot().catch((e: Error) => fail(`Couldn't read ${slug} on GitHub: ${e.message}`));
  if (!(await t.canWrite())) fail(`Your GitHub login can't write to ${slug}, so agents couldn't record their work there.`);

  console.log(`${slug}: ${s.milestones.length ? `${s.milestones.length} milestone(s), the plan is live.` : "no plan yet. Ask your agent to make one."}`);
  const local = connectLocal(root);
  if (local === "added") console.log("✓ Claude Code: connected in this folder");
  else if (local === "already") console.log("✓ Claude Code: already connected in this folder");
  else if (local === "failed") console.log("✗ Claude Code: couldn't connect here. The pull request below connects it too.");

  if (!values.yes && !(await ask("\nSet up this repo: connect every agent that works in it, and serve its dashboard from the repo's own GitHub Pages? This opens a pull request."))) {
    console.log("\nNothing changed in the repo. Run `gam dashboard` for a local dashboard.");
    return;
  }

  let dashboard: string | null = null;
  if (s.private) {
    console.log("· Private repo: no public dashboard. Run `gam dashboard` for a local one, or `gam site <folder>` to host it where only you can reach it.");
  } else {
    const pages = await setUpPages(t);
    if ("url" in pages) dashboard = pages.url;
    else console.log(`· No dashboard on GitHub Pages: ${pages.reason}. Run \`gam site <folder>\` and host it on your own domain, then put \`dashboard: <url>\` in .github/gam.yml.`);
  }

  const pr = await proposeRepoFiles(t, s, dashboard, { readme: true, workflow: true, agents: true });
  if (pr) {
    console.log(`✓ ${pr.url}`);
    console.log(`  ${pr.changed.join(", ")}`);
    console.log("  Merge it and pull. Codex reads .codex/config.toml once you trust the project in Codex.");
  } else {
    console.log("✓ The repo is already connected.");
  }
  if (dashboard) console.log(`\nDashboard: ${dashboard} (live once the pull request is merged)`);
}

async function site(dir: string, repos: string[]): Promise<void> {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), siteHtml(__VIEWER_HTML__, repos));
  writeFileSync(join(dir, ".nojekyll"), "");
  console.log(`${join(dir, "index.html")}: a dashboard for ${repos.join(", ")}. Host the folder on any static host. Private repos ask the viewer for a read-only token.`);
}

function openFile(path: string): void {
  const [cmd, args] = process.platform === "darwin" ? ["open", [path]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", path]] : ["xdg-open", [path]];
  spawn(cmd as string, args as string[], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

async function dashboard(t: GitHubTracker, out?: string): Promise<void> {
  const path = out ?? join(tmpdir(), `gam-${t.owner}-${t.repo}.html`);
  writeFileSync(path, dashboardHtml(__VIEWER_HTML__, await t.snapshot(), new Date()), { mode: 0o600 });
  console.log(path);
  if (process.stdout.isTTY) openFile(path);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      repo: { type: "string" },
      json: { type: "boolean" },
      out: { type: "string" },
      repos: { type: "string" },
      new: { type: "string" },
      takeover: { type: "boolean" },
      role: { type: "string" },
      unblock: { type: "boolean" },
      evidence: { type: "string" },
      met: { type: "string" },
      "no-code": { type: "boolean" },
      merge: { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      "agents-md": { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help) return console.log(HELP);
  if (values.version) return console.log(VERSION);
  if (command === "mcp") return serveMcp(VERSION);
  if (command === "hook") return runHook(rest[0]);
  if (!command || command === "connect") return connect(values);

  if (command === "site") {
    if (!rest[0]) fail("gam site needs a folder to write to.");
    const repos = values.repos ? values.repos.split(",").map((r) => r.trim()).filter(Boolean) : [];
    if (!repos.length) {
      const found = values.repo ? parseSlug(values.repo) : detectRepo();
      if (!found) fail("Run this inside a GitHub repo's folder, or pass --repos owner/name,...");
      repos.push(`${found.owner}/${found.repo}`);
    }
    if (repos.some((r) => !parseSlug(r))) fail("--repos takes owner/name pairs, separated by commas.");
    return site(rest[0], repos);
  }
  const t = tracker(values.repo);
  if (command === "dashboard") return dashboard(t, values.out);
  const ctx: Ctx = { tracker: t, agent: process.env.GAM_AGENT || "cli", role: process.env.GAM_ROLE, currentBranch: currentBranch() };
  const number = /^\d+$/.test(rest[0] ?? "") ? Number(rest.shift()) : undefined;
  let result: Result;

  switch (command) {
    case "status":
      result = await status(ctx);
      break;
    case "agenda":
      result = await agenda(ctx, { text: rest.join(" ") });
      break;
    case "plan": {
      const path = rest[0] ?? "-";
      result = await plan(ctx, toPlan(JSON.parse(readFileSync(path === "-" ? 0 : path, "utf8"))));
      break;
    }
    case "claim":
      result = await claim(ctx, { issue: number, new: values.new ? { title: values.new } : undefined, role: values.role, takeover: values.takeover });
      break;
    case "update":
      result = await update(ctx, { issue: number, note: rest.join(" "), unblock: values.unblock });
      break;
    case "finish":
      if (!values.evidence) fail("gam finish needs --evidence.");
      result = await finish(ctx, { issue: number, evidence: values.evidence, met: values.met?.split(",").map(Number), noCode: values["no-code"], merge: values.merge });
      break;
    case "block":
      result = await block(ctx, { issue: number, reason: rest.join(" ") });
      break;
    default:
      fail(`Unknown command ${command}.\n\n${HELP}`);
  }

  if (command !== "status") await refreshStatus(t).catch(() => {});
  console.log(values.json ? JSON.stringify(result) : format(result));
}

main().catch((e) => {
  if (e instanceof OpError) {
    console.error(format({ ok: false, text: e.message, next: e.next }));
  } else {
    console.error(`Failed: ${(e as Error).message}`);
  }
  process.exit(1);
});
