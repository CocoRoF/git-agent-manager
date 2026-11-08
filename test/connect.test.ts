import assert from "node:assert/strict";
import { it } from "node:test";
import { END, POINTER, START, readmeBlock, withBlock, withCodexToml, withDashboard, withMcpJson, workflow } from "../src/connect.ts";
import { parseConfig } from "../src/derive.ts";
import { workOutsideTask } from "../src/hooks.ts";

const own = "https://o.github.io/r/";
const block = readmeBlock("o", "r", false, own);

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
  assert.match(changed, /Body/);
});

it("links the card to the repo's own dashboard, never to someone else's site", () => {
  assert.match(block, /\]\(https:\/\/o\.github\.io\/r\/\)/);
  assert.doesNotMatch(block, /cocorof/i);
  assert.match(readmeBlock("o", "r", false, null), /github\.com\/o\/r\/milestones/);
});

it("links only in a private repo, where an image can't load", () => {
  assert.doesNotMatch(readmeBlock("o", "r", true, null), /raw\.githubusercontent/);
  assert.match(readmeBlock("o", "r", true, "https://plan.example.com/"), /plan\.example\.com/);
});

it("adds itself to .mcp.json next to the repo's servers, once", () => {
  const next = JSON.parse(withMcpJson(JSON.stringify({ mcpServers: { other: { command: "x" } } }))!);
  assert.deepEqual(Object.keys(next.mcpServers), ["other", "gam"]);
  assert.deepEqual(next.mcpServers.gam.args, ["-y", "git-agent-manager", "mcp"]);
  assert.equal(withMcpJson(JSON.stringify(next)), null);
});

it("appends a Codex table and keeps the rest of the file", () => {
  const next = withCodexToml('model = "x"\n')!;
  assert.match(next, /^model = "x"\n\n\[mcp_servers\.gam\]\ncommand = "npx"\nargs = \["-y", "git-agent-manager", "mcp"\]\n$/);
  assert.equal(withCodexToml(next), null);
});

it("tells agents how to handle small jobs in AGENTS.md", () => {
  const next = withBlock("# Agents\n\nBe terse.\n", POINTER);
  assert.match(next, /Be terse/);
  assert.match(next, /`gam_claim` with `new`/);
});

it("records the dashboard address in the settings, keeping the rest", () => {
  assert.equal(withDashboard(null, own), `dashboard: ${own}\n`);
  const next = withDashboard("merge: agent\n", own)!;
  assert.equal(next, `merge: agent\ndashboard: ${own}\n`);
  assert.equal(withDashboard(next, own), null);
  assert.equal(parseConfig(next).dashboard, own);
  assert.equal(parseConfig("dashboard: http://insecure.example").dashboard, null);
});

it("deploys the dashboard only from the default branch", () => {
  const w = workflow("trunk", true);
  assert.match(w, /push:\n    branches: \["trunk"\]/);
  assert.match(w, /site: _site/);
  assert.match(w, /actions\/deploy-pages@v4/);
  assert.doesNotMatch(workflow("trunk", false), /deploy-pages|push:/);
});

it("only nudges about work with no task behind it", () => {
  assert.equal(workOutsideTask("main", " M a.ts", ""), true);
  assert.equal(workOutsideTask("main", "", "2"), true);
  assert.equal(workOutsideTask("main", "", ""), false);
  assert.equal(workOutsideTask("task/4-x", " M a.ts", "2"), false);
  assert.equal(workOutsideTask(null, " M a.ts", ""), true);
});
