import assert from "node:assert/strict";
import { it } from "node:test";
import { branchIssue, branchName, closingIssues, parseCriteria, tickCriteria } from "../src/derive.ts";
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
