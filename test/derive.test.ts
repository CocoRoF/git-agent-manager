import assert from "node:assert/strict";
import { it } from "node:test";
import { auditCommits, branchIssue, branchName, closingIssues, milestoneAgenda, parseConfig, parseCriteria, tickCriteria } from "../src/derive.ts";
import type { CommitRef, Pull, Snapshot } from "../src/model.ts";
import { parseRemote } from "../src/local.ts";

it("reads task branches", () => {
  assert.equal(branchIssue("task/12-do-it"), 12);
  assert.equal(branchIssue("task/12"), 12);
  assert.equal(branchIssue("task/x"), null);
  assert.equal(branchIssue("feature/12"), null);
});

it("makes branch names, even from titles with no latin letters", () => {
  assert.equal(branchName({ number: 3, title: "Fix the Login Page!" }), "task/3-fix-the-login-page");
  assert.equal(branchName({ number: 3, title: "로그인 고치기" }), "task/3");
});

it("finds closing keywords", () => {
  assert.deepEqual(closingIssues("Closes #1, fixes: #2 and resolved #3. See #4."), [1, 2, 3]);
});

it("reads and ticks checkboxes", () => {
  const body = "intro\n- [ ] one\n- [x] two\n* [ ] three";
  assert.deepEqual(parseCriteria(body).map((c) => c.met), [false, true, false]);
  assert.equal(tickCriteria(body, [3]), "intro\n- [ ] one\n- [x] two\n* [x] three");
});

it("parses GitHub remotes", () => {
  assert.deepEqual(parseRemote("https://github.com/o/r.git"), { owner: "o", repo: "r" });
  assert.deepEqual(parseRemote("git@github.com:o/r.git"), { owner: "o", repo: "r" });
  assert.deepEqual(parseRemote("ssh://git@github.com/o/my.repo"), { owner: "o", repo: "my.repo" });
  assert.equal(parseRemote("https://gitlab.com/o/r.git"), null);
});

it("flags commits no task accounts for", () => {
  const c = (sha: string, message: string, bot = false): CommitRef => ({ sha, message, url: "", author: "a", bot });
  const p = (number: number, headRef: string, body = ""): Pull => ({ number, title: "", body, headRef, headRepo: "o/r", state: "closed", mergedAt: "x", draft: false, url: "", createdAt: "" });
  const s = {
    pulls: [p(1, "task/5-x"), p(2, "feature", "Closes #6"), p(3, "feature-b"), p(4, "git-agent-manager/connect")],
    commits: [
      c("a", "Add thing (#1)"),
      c("b", "Merge pull request #2 from o/feature"),
      c("c", "Stray change (#3)"),
      c("d", "direct push to main"),
      c("e", "Fix it\n\nCloses #7"),
      c("f", "Bump dep", true),
      c("g", "Old work (#99)"),
      c("h", "Connect git-agent-manager (#4)"),
    ],
  } as unknown as Snapshot;
  const a = auditCommits(s);
  assert.equal(a.checked, 7);
  assert.deepEqual(a.offPlan.map((x) => x.sha), ["c", "d"]);
});

it("reads repo settings, defaulting to auto", () => {
  assert.equal(parseConfig("").approval, "auto");
  assert.equal(parseConfig("approval: required\n").approval, "required");
  assert.equal(parseConfig('# note\napproval: "required"').approval, "required");
  assert.equal(parseConfig("approval: whatever").approval, "auto");
  assert.equal(parseConfig("").merge, "human");
  assert.equal(parseConfig("merge: agent").merge, "agent");
});

it("reads a milestone's agenda", () => {
  assert.equal(milestoneAgenda({ description: "Text\n\nAgenda: #12" }), 12);
  assert.equal(milestoneAgenda({ description: "see Agenda: #12 above" }), null);
});
