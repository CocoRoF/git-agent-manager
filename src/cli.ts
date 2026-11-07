import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { connectAgents, proposeRepoFiles } from "./connect.ts";
import { dashboardHtml } from "./dashboard.ts";
import { GitHubTracker } from "./github.ts";
import { runHook } from "./hooks.ts";
import { currentBranch, detectRepo, findToken } from "./local.ts";
import { parseSlug, serveMcp, toPlan } from "./mcp.ts";
import { refreshStatus } from "./svg.ts";
import { OpError, VIEWER, agenda, block, claim, finish, format, plan, status, update, type Ctx, type Result } from "./ops.ts";

declare const __VERSION__: string;
declare const __VIEWER_HTML__: string;
const VERSION = typeof __VERSION__ === "string" ? __VERSION__ : "dev";

const HELP = `git-agent-manager ${VERSION}

  npx github:CocoRoF/git-agent-manager          connect your agents and this repo

  gam status                                    where the plan stands
  gam agenda <text>                             hand agents a goal to plan and carry out
  gam plan <file.json | ->                      create or extend the plan
  gam claim [issue] [--new title] [--takeover]  take a task
  gam update [issue] <note> [--unblock]         add a line of progress
  gam finish [issue] --evidence text [--met 1,2] [--no-code] [--merge]
  gam block [issue] <reason>
  gam dashboard [--out file.html]               write the dashboard to a file and open it
  gam mcp                                       run the MCP server

  --repo owner/name   use this repo instead of the current folder's origin
  --json              print machine-readable output
  GAM_AGENT           the name this agent signs its work with
  GAM_ROLE            prefer tasks with this role:* label`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function tracker(slug?: string): GitHubTracker {
  const found = slug ? parseSlug(slug) : detectRepo();
  if (!found) fail("This folder has no GitHub origin remote. Pass --repo owner/name.");
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

async function connect(values: { repo?: string; yes?: boolean }): Promise<void> {
  const agents = connectAgents();
  if (!agents.length) console.log("No agents found on this machine. Add this MCP server to yours:\n  npx -y github:CocoRoF/git-agent-manager mcp");
  for (const a of agents) {
    const word = { added: "connected", already: "already connected", failed: "could not connect" }[a.result];
    console.log(`${a.result === "failed" ? "✗" : "✓"} ${a.agent}: ${word}`);
  }

  const found = values.repo ? parseSlug(values.repo) : detectRepo();
  if (!found) {
    console.log("\nDone. Your agents can now plan in any GitHub repo.");
    return;
  }
  const token = findToken();
  if (!token) fail("\nNo GitHub login found. Run `gh auth login`, then run this again.");
  const t = new GitHubTracker(found.owner, found.repo, token);
  const s = await t.snapshot();
  console.log(`\n${found.owner}/${found.repo}: ${s.milestones.length ? `${s.milestones.length} milestone(s) found, the plan is live.` : "no plan yet. Ask your agent to make one."}`);
  console.log(`Dashboard: ${VIEWER}#/${found.owner}/${found.repo}`);
  if (values.yes || (await ask("\nAdd a progress card to the README, as a pull request?"))) {
    const url = await proposeRepoFiles(t, s.private, { readme: true, workflow: true, pointer: false });
    console.log(url ? `✓ ${url}` : "✓ The README already has it.");
  }
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
      new: { type: "string" },
      takeover: { type: "boolean" },
      role: { type: "string" },
      unblock: { type: "boolean" },
      evidence: { type: "string" },
      met: { type: "string" },
      "no-code": { type: "boolean" },
      merge: { type: "boolean" },
      yes: { type: "boolean", short: "y" },
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
