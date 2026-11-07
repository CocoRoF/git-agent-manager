// Runs against a real repo: GAM_E2E=1 GAM_E2E_REPO=owner/name npm run test:e2e
// It deletes every milestone and task branch there, so point it at a scratch repo.
import assert from "node:assert/strict";
import { before, it } from "node:test";
import { deriveTasks } from "../../src/derive.ts";
import { GitHubTracker } from "../../src/github.ts";
import { findToken } from "../../src/local.ts";
import { OpError, agenda, claim, finish, plan, status, update, type Ctx } from "../../src/ops.ts";
import type { Snapshot } from "../../src/model.ts";
import { renderStatus } from "../../src/svg.ts";

const enabled = process.env.GAM_E2E === "1";
const [owner, repo] = (process.env.GAM_E2E_REPO ?? "CocoRoF/gam-sandbox").split("/") as [string, string];
const token = enabled ? findToken()! : "";
const t = new GitHubTracker(owner, repo, token);
const ctx = (agent: string): Ctx => ({ tracker: t, agent });

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const send = () =>
    fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  const res = await send().catch(() => new Promise((r) => setTimeout(r, 3000)).then(send));
  const text = await res.text();
  if (res.status >= 400) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function commitTo(branch: string, name: string): Promise<void> {
  await api("PUT", `/contents/${name}`, { message: `add ${name}`, content: Buffer.from(name).toString("base64"), branch });
}

async function settled(ok: (s: Snapshot) => boolean): Promise<Snapshot> {
  for (let i = 0; i < 20; i++) {
    const s = await t.snapshot();
    if (ok(s)) return s;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("GitHub did not settle");
}

before(async () => {
  if (!enabled) return;
  for (const m of await api("GET", "/milestones?state=all&per_page=100")) await api("DELETE", `/milestones/${m.number}`);
  for (const i of await api("GET", "/issues?state=open&per_page=100")) if (!i.pull_request) await api("PATCH", `/issues/${i.number}`, { state: "closed", state_reason: "not_planned", labels: [] });
  for (const p of await api("GET", "/pulls?state=open&per_page=100")) await api("PATCH", `/pulls/${p.number}`, { state: "closed" });
  for (const r of await api("GET", "/git/matching-refs/heads/task/")) await api("DELETE", `/git/${r.ref}`);
});

it("runs a whole plan on real GitHub", { skip: !enabled, timeout: 180_000 }, async () => {
  const title = `E2E ${Date.now()}`;
  const made = await plan(ctx("planner"), {
    milestones: [
      {
        title,
        exitCriteria: ["shipped"],
        tasks: [
          { title: "Alpha 첫 작업", why: "start here", criteria: ["alpha works"] },
          { title: "Beta", blockedBy: ["Alpha 첫 작업"] },
          { title: "Gamma" },
          { title: "Delta" },
        ],
      },
    ],
  });
  const ids = (made.data as { created: Record<string, number> }).created;
  const alpha = ids["Alpha 첫 작업"]!;
  const beta = ids.Beta!;
  const gamma = ids.Gamma!;
  const delta = ids.Delta!;

  // Lists lag behind writes by a few seconds, so wait for them before racing.
  let s = await settled((x) => {
    const tasks = deriveTasks(x);
    return tasks.filter((k) => k.issue.milestone !== null).length === 4 && tasks.find((k) => k.issue.number === beta)!.state === "blocked";
  });

  // Eight agents race: three tasks are free, so exactly three get one, and all different.
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => claim(ctx(`racer${i}`), {})));
  const won = results.flatMap((r) => (r.status === "fulfilled" ? [(r.value.data as { issue: number }).issue] : []));
  for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof OpError, String(r.reason));
  assert.equal(new Set(won).size, won.length, `same task given twice: ${won}`);
  assert.deepEqual([...won].sort((a, b) => a - b), [alpha, gamma, delta].sort((a, b) => a - b));

  s = await settled((x) => deriveTasks(x).filter((k) => k.state === "in_progress").length === 3);
  const racer = (n: number) => `racer${won.indexOf(n)}`;
  const alphaBranch = deriveTasks(s).find((x) => x.issue.number === alpha)!.branch!;
  assert.equal(alphaBranch, `task/${alpha}-alpha`);

  // A claimed task can't be taken without saying so.
  await assert.rejects(claim(ctx("late"), { issue: alpha }), /held by/);
  await update(ctx(racer(alpha)), { issue: alpha, note: "half way" });
  assert.equal((await t.listComments(alpha)).length, 1);

  // No commits: finishing is refused rather than falsely closed.
  await assert.rejects(finish(ctx(racer(alpha)), { issue: alpha, evidence: "x", met: [1] }), /no commits/);

  await commitTo(alphaBranch, `alpha-${Date.now()}.txt`);
  const done = await finish(ctx(racer(alpha)), { issue: alpha, evidence: "tests pass", met: [1] });
  const pull = (done.data as { pull: number }).pull;
  s = await settled((x) => deriveTasks(x).find((k) => k.issue.number === alpha)!.state === "in_review");

  // Merging is what closes the task, and it unblocks the next one.
  await api("PUT", `/pulls/${pull}/merge`, { merge_method: "squash" });
  s = await settled((x) => {
    const tasks = deriveTasks(x);
    return tasks.find((k) => k.issue.number === alpha)!.state === "done" && tasks.find((k) => k.issue.number === beta)!.state === "ready";
  });
  const merged = deriveTasks(s).find((x) => x.issue.number === alpha)!;
  assert.equal(merged.state, "done");
  assert.equal(merged.evidence, "merged_pr");
  assert.match(merged.issue.body, /- \[x\] alpha works/);
  assert.equal(deriveTasks(s).find((x) => x.issue.number === beta)!.issue.blockedBy, 0);
  assert.equal(deriveTasks(s).find((x) => x.issue.number === beta)!.state, "ready");
  assert.match((await status(ctx("late"))).next!, new RegExp(`#${beta} Beta`));

  // Unplanned work is recorded with one call and stays out of the milestone.
  const quick = await claim(ctx("late"), { new: { title: "오타 수정" } });
  const q = (quick.data as { issue: number; branch: string });
  assert.equal(q.branch, `task/${q.issue}`);
  await finish(ctx("late"), { issue: q.issue, evidence: "no code", noCode: true });
  s = await settled((x) => deriveTasks(x).find((k) => k.issue.number === q.issue)?.state === "done");
  const unplanned = deriveTasks(s).find((x) => x.issue.number === q.issue)!;
  assert.equal(unplanned.state, "done");
  assert.equal(unplanned.evidence, "closed");
  assert.equal(unplanned.issue.milestone, null);

  // Publishes the image on a ref that doesn't show up as a branch.
  await t.publishStatus(renderStatus(s));
  const branches = (await api("GET", "/branches?per_page=100")).map((b: { name: string }) => b.name);
  assert.ok(!branches.some((b: string) => b.startsWith("gam")));
  const img = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/refs/gam/status/status.svg`);
  assert.equal(img.status, 200);
  assert.match(await img.text(), /<svg/);
});

it("takes an agenda through a plan, an agent merge and closure", { skip: !enabled, timeout: 240_000 }, async () => {
  for (const m of await api("GET", "/milestones?state=open&per_page=100")) await api("DELETE", `/milestones/${m.number}`);
  const config = await t.readFile(".github/gam.yml");
  if (!config?.text.includes("merge: agent")) {
    await api("PUT", "/contents/.github/gam.yml", { message: "Let agents merge", content: Buffer.from("merge: agent\n").toString("base64"), sha: config?.sha });
  }

  const made = await agenda(ctx("boss"), { text: "경쟁사 분석 보고서를 만들어 줘" });
  const a = (made.data as { issue: number }).issue;
  await settled((x) => x.agendas.some((i) => i.number === a));
  const first = await status(ctx("lead"));
  assert.match(first.next!, new RegExp(`agenda: ${a}`));

  const planned = await plan(ctx("lead"), { agenda: a, milestones: [{ title: `Agenda ${Date.now()}`, tasks: [{ title: "Collect prices" }] }] });
  const task = (planned.data as { created: Record<string, number> }).created["Collect prices"]!;
  await settled((x) => deriveTasks(x).some((k) => k.issue.number === task));

  const held = await claim(ctx("worker"), {});
  const branch = (held.data as { branch: string }).branch;
  await commitTo(branch, `prices-${Date.now()}.txt`);

  // The first attempt opens the PR, and it won't merge before checks have had a chance to start.
  const opened = await finish(ctx("worker"), { issue: task, evidence: "collected", merge: true });
  assert.match(opened.text, /may not have started|still running/);
  const pull = (opened.data as { pull: number }).pull;
  let merged = false;
  for (let i = 0; i < 30 && !merged; i++) {
    await new Promise((r) => setTimeout(r, 6000));
    const again = await finish(ctx("worker"), { issue: task, evidence: "collected", merge: true });
    merged = /Merged/.test(again.text);
  }
  assert.ok(merged, "agent merge never went through");
  const commits = await api("GET", "/commits?sha=main&per_page=1");
  assert.match(commits[0].commit.message.split("\n")[0], new RegExp(`\\(#${pull}\\)$`));

  const s = await settled((x) => deriveTasks(x).find((k) => k.issue.number === task)?.state === "done" && x.milestones.some((m) => m.open === 0 && m.state === "open"));
  const m = s.milestones.find((x) => x.state === "open" && x.open === 0)!;
  const closed = await plan(ctx("lead"), { closeMilestones: [{ number: m.number, evidence: "report done" }] });
  assert.match(closed.text, new RegExp(`closed agenda #${a}`));
  assert.equal((await t.getIssue(a)).state, "closed");
});
