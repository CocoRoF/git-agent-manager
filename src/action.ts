import { appendFileSync, readFileSync } from "node:fs";
import { checkPull, linkedIssue, type Finding, type PullEvent } from "./check.ts";
import { GitHubTracker } from "./github.ts";
import { refreshStatus } from "./svg.ts";

function input(name: string): string {
  return process.env[`INPUT_${name.toUpperCase()}`]?.trim() ?? "";
}

function escapeData(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function annotate(f: Finding): void {
  console.log(`::${f.level}::${escapeData(f.message)}`);
}

function summary(lines: string[]): void {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
}

async function checkPullEvent(t: GitHubTracker, event: any, strict: boolean): Promise<void> {
  const raw = event.pull_request;
  const pull: PullEvent = {
    number: raw.number,
    body: raw.body ?? "",
    headRef: raw.head?.ref ?? "",
    headRepo: raw.head?.repo?.full_name ?? null,
    authorType: raw.user?.type ?? "User",
  };
  const s = await t.snapshot();
  const n = linkedIssue(pull);
  const issue = n ? await t.getIssue(n).catch(() => null) : null;
  const findings = checkPull(s, pull, issue);
  findings.forEach(annotate);
  summary(findings.length ? ["### Plan check", ...findings.map((f) => `- ${f.message}`)] : ["### Plan check", n ? `Linked to #${n}.` : "Nothing to check."]);
  if (strict && findings.some((f) => f.level !== "notice")) process.exitCode = 1;
}

async function main(): Promise<void> {
  const token = input("token");
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
  if (!token || !owner || !repo) throw new Error("Needs a token and GITHUB_REPOSITORY.");
  const t = new GitHubTracker(owner, repo, token);
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8"));

  if (process.env.GITHUB_EVENT_NAME?.startsWith("pull_request")) {
    await checkPullEvent(t, event, input("mode") === "strict");
    // A fork's token is read-only, so only a merge into this repo refreshes the image.
    if (!(event.action === "closed" && event.pull_request?.merged)) return;
  }
  await refreshStatus(t);
}

main().catch((e) => {
  // The image and the check are conveniences. They should never be why a repo's CI goes red.
  console.log(`::warning::git-agent-manager: ${escapeData((e as Error).message)}`);
});
