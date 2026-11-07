import { spawnSync } from "node:child_process";

function git(args: string[], input?: string, cwd?: string): string | null {
  const r = spawnSync("git", args, { cwd, input, encoding: "utf8", timeout: 10_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" } });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function parseRemote(url: string): { owner: string; repo: string } | null {
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url);
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

export function detectRepo(cwd?: string): { owner: string; repo: string } | null {
  const url = git(["remote", "get-url", "origin"], undefined, cwd);
  return url ? parseRemote(url) : null;
}

export function currentBranch(cwd?: string): string | null {
  return git(["branch", "--show-current"], undefined, cwd) || null;
}

/** Uses whatever GitHub login the machine already has, so there is nothing to set up. */
export function findToken(): string | null {
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env) return env;
  const gh = spawnSync("gh", ["auth", "token"], { encoding: "utf8", timeout: 10_000 });
  if (gh.status === 0 && gh.stdout.trim()) return gh.stdout.trim();
  const filled = git(["credential", "fill"], "protocol=https\nhost=github.com\n\n");
  return filled ? (/^password=(.+)$/m.exec(filled)?.[1] ?? null) : null;
}
