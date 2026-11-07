import assert from "node:assert/strict";
import { it } from "node:test";
import { checkPull, linkedIssue, type PullEvent } from "../src/check.ts";
import { FakeTracker } from "./fake.ts";

const pull = (o: Partial<PullEvent> = {}): PullEvent => ({ number: 9, body: "", headRef: "feature", headRepo: "o/r", authorType: "User", ...o });

async function repo() {
  const t = new FakeTracker();
  await t.createMilestone({ title: "M1" });
  await t.createMilestone({ title: "M2" });
  return t;
}

it("reads the link from the branch or the description", () => {
  assert.equal(linkedIssue(pull({ headRef: "task/5-x" })), 5);
  assert.equal(linkedIssue(pull({ body: "Fixes #7" })), 7);
  assert.equal(linkedIssue(pull()), null);
});

it("warns about a pull request with no task", async () => {
  const t = await repo();
  t.seed({ title: "a", milestone: 1 });
  const f = checkPull(await t.snapshot(), pull(), null);
  assert.equal(f[0]!.level, "warning");
  assert.match(f[0]!.message, /isn't linked/);
});

it("leaves repos without a plan, forks and bots alone", async () => {
  const empty = new FakeTracker();
  assert.deepEqual(checkPull(await empty.snapshot(), pull(), null), []);
  const t = await repo();
  assert.deepEqual(checkPull(await t.snapshot(), pull({ headRepo: "stranger/r" }), null), []);
  assert.deepEqual(checkPull(await t.snapshot(), pull({ authorType: "Bot" }), null), []);
});

it("passes a clean task and flags what isn't", async () => {
  const t = await repo();
  const good = t.seed({ title: "good", milestone: 1, body: "- [x] done" });
  const open = t.seed({ title: "open", milestone: 1, body: "- [ ] not yet" });
  const later = t.seed({ title: "later", milestone: 2 });
  const stray = t.seed({ title: "stray" });
  const small = t.seed({ title: "small", labels: ["unplanned"] });
  const s = await t.snapshot();
  assert.deepEqual(checkPull(s, pull(), good), []);
  assert.match(checkPull(s, pull(), open)[0]!.message, /not yet/);
  assert.equal(checkPull(s, pull(), later)[0]!.level, "notice");
  assert.match(checkPull(s, pull(), stray)[0]!.message, /isn't in a milestone/);
  assert.deepEqual(checkPull(s, pull(), small), []);
});
