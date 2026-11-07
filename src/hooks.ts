import { spawnSync } from "node:child_process";
import { branchIssue } from "./derive.ts";
import { GitHubTracker } from "./github.ts";
import { currentBranch, detectRepo, findToken } from "./local.ts";
import { format, status } from "./ops.ts";

/** A hook must never get in the agent's way, so it gives up quietly if GitHub is slow. */
const HOOK_DEADLINE_MS = 8000;

function git(args: string[]): string {
  const r = spawnSync("git", args, { encoding: "utf8", timeout: 3000 });
  return r.status === 0 ? r.stdout.trim() : "";
}

function hasPlan(owner: string, repo: string, token: string): Promise<boolean> {
  return fetch(`https://api.github.com/repos/${owner}/${repo}/milestones?state=open&per_page=1`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "git-agent-manager" },
  }).then(async (r) => r.ok && ((await r.json()) as unknown[]).length > 0);
}

/** Text for the agent at session start, or nothing when the repo has no plan. */
export async function sessionStart(agent: string): Promise<string> {
  const found = detectRepo();
  const token = findToken();
  if (!found || !token || !(await hasPlan(found.owner, found.repo, token))) return "";
  const tracker = new GitHubTracker(found.owner, found.repo, token);
  return `git-agent-manager: this repo works from a plan.\n${format(await status({ tracker, agent, currentBranch: currentBranch() }))}`;
}

export function workOutsideTask(branch: string | null, dirty: string, unpushed: string): boolean {
  if (branch && branchIssue(branch) !== null) return false;
  return dirty !== "" || unpushed !== "";
}

/** A reason to keep going once, when work was done in a planned repo with no task behind it. */
export async function stopCheck(input: { stop_hook_active?: boolean }): Promise<string> {
  // Claude Code sets this when it's already continuing because of a stop hook. Nudging again would loop.
  if (input.stop_hook_active) return "";
  const dirty = git(["status", "--porcelain"]);
  const unpushed = git(["rev-list", "--count", "@{upstream}..HEAD"]);
  if (!workOutsideTask(currentBranch(), dirty, unpushed === "0" ? "" : unpushed)) return "";
  const found = detectRepo();
  const token = findToken();
  if (!found || !token || !(await hasPlan(found.owner, found.repo, token))) return "";
  return "This repo works from a plan, and these changes aren't on a task branch. If they're meant to stay, record them: call gam_claim (with new for small work) and move them to its branch. If they're only a scratch experiment, say so and stop.";
}

async function readStdin(): Promise<any> {
  if (process.stdin.isTTY) return {};
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

export async function runHook(name: string | undefined): Promise<void> {
  const deadline = new Promise<string>((resolve) => setTimeout(() => resolve(""), HOOK_DEADLINE_MS).unref());
  const work = (async () => {
    const input = await readStdin();
    if (name === "session-start") return sessionStart(process.env.GAM_AGENT || "claude-code");
    if (name === "stop") {
      const reason = await stopCheck(input);
      return reason ? JSON.stringify({ decision: "block", reason }) : "";
    }
    return "";
  })().catch(() => "");
  const out = await Promise.race([work, deadline]);
  if (out) console.log(out);
  process.exit(0);
}
