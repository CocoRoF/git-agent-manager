import assert from "node:assert/strict";
import { it } from "node:test";
import { END, GLOBAL_POINTER, START, readmeBlock, withBlock, withHooks, withPointer } from "../src/connect.ts";
import { workOutsideTask } from "../src/hooks.ts";

const block = readmeBlock("o", "r", false);

it("puts the block after the title with blank lines around it", () => {
  assert.equal(withBlock("# Title\nText", block), `# Title\n\n${block}\n\nText`);
  assert.equal(withBlock("# Title\n\nText", block), `# Title\n\n${block}\n\nText`);
  assert.equal(withBlock("No title", block), `${block}\n\nNo title`);
});

it("replaces its own block and changes nothing else", () => {
  const once = withBlock("# T\n\nBody\n", block);
  assert.equal(withBlock(once, block), once);
  const changed = withBlock(once, `${START}\nnew\n${END}`);
  assert.match(changed, /new/);
  assert.doesNotMatch(changed, /raw\.githubusercontent/);
  assert.match(changed, /Body/);
});

it("links only in a private repo, where an image can't load", () => {
  assert.doesNotMatch(readmeBlock("o", "r", true), /raw\.githubusercontent/);
  assert.match(readmeBlock("o", "r", true), /#\/o\/r/);
});

const cmd = 'node "/x/git-agent-manager/cli.js"';

it("adds hooks next to the user's own, once", () => {
  const theirs = { theme: "dark", hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] } };
  const next = withHooks(theirs, cmd);
  assert.equal(next.theme, "dark");
  assert.equal(next.hooks.Stop.length, 2);
  assert.equal(next.hooks.Stop[0].hooks[0].command, "say done");
  assert.equal(next.hooks.SessionStart[0].hooks[0].command, `${cmd} hook session-start`);
  assert.equal(withHooks(next, cmd), null);
});

it("moves its hooks when the program moves", () => {
  const next = withHooks(withHooks({}, cmd), 'node "/y/git-agent-manager/cli.js"');
  assert.equal(next.hooks.Stop.length, 1);
  assert.match(next.hooks.Stop[0].hooks[0].command, /\/y\//);
});

it("only nudges about work with no task behind it", () => {
  assert.equal(workOutsideTask("main", " M a.ts", ""), true);
  assert.equal(workOutsideTask("main", "", "2"), true);
  assert.equal(workOutsideTask("main", "", ""), false);
  assert.equal(workOutsideTask("task/4-x", " M a.ts", "2"), false);
  assert.equal(workOutsideTask(null, " M a.ts", ""), true);
});

it("keeps the user's own instructions around its pointer", () => {
  assert.equal(withPointer("", GLOBAL_POINTER), `${GLOBAL_POINTER}\n`);
  const once = withPointer("# Mine\nBe terse.\n", GLOBAL_POINTER);
  assert.match(once, /^# Mine\nBe terse\.\n\n<!-- gam:start -->/);
  assert.equal(withPointer(once, GLOBAL_POINTER), once);
  assert.match(withPointer(`${START}\nold\n${END}\nAfter`, GLOBAL_POINTER), /gam_status[\s\S]*After/);
});
