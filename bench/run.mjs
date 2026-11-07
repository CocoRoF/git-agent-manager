// Measures whether agents keep work on the plan, with fixed tasks on a scratch repo.
//   node bench/run.mjs                    every scenario and condition
//   node bench/run.mjs claude-mcp fix     only matching runs
// It wipes the scratch repo's plan and rewrites main. Results go to bench/results.jsonl.
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = process.env.GAM_BENCH_REPO ?? "CocoRoF/gam-sandbox";
const CLI = resolve(process.env.GAM_BENCH_CLI ?? "dist/cli.js");
const LIMIT_MS = 8 * 60 * 1000;
const filter = process.argv.slice(2);

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", timeout: 60_000, ...opts });
}
const token = /^password=(.+)$/m.exec(sh("git", ["credential", "fill"], { input: "protocol=https\nhost=github.com\n\n" }).stdout)[1];

async function api(method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (res.status >= 400 && res.status !== 404 && res.status !== 422) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const FILES = {
  "README.md": "# Tiny calculator\n\nA small calcuator library with no dependencies.\n",
  "calc.js": "export function add(a, b) {\n  return a + b;\n}\n",
  "calc.test.js": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { add } from "./calc.js";\n\ntest("add", () => assert.equal(add(2, 3), 5));\n',
  "package.json": '{ "name": "tiny-calc", "type": "module", "scripts": { "test": "node --test" } }\n',
};

async function reset() {
  for (const m of await api("GET", "/milestones?state=all&per_page=100")) await api("DELETE", `/milestones/${m.number}`);
  for (const i of await api("GET", "/issues?state=open&per_page=100")) if (!i.pull_request) await api("PATCH", `/issues/${i.number}`, { state: "closed", state_reason: "not_planned", labels: [] });
  for (const p of await api("GET", "/pulls?state=open&per_page=100")) await api("PATCH", `/pulls/${p.number}`, { state: "closed" });
  for (const r of await api("GET", "/git/matching-refs/heads/?per_page=100")) if (r.ref !== "refs/heads/main") await api("DELETE", `/git/${r.ref}`);
  // Start main over from a single commit, so each run sees the same repo.
  const tree = await api("POST", "/git/trees", { tree: Object.entries(FILES).map(([path, content]) => ({ path, mode: "100644", type: "blob", content })) });
  const commit = await api("POST", "/git/commits", { message: "Start", tree: tree.sha, parents: [] });
  await api("PATCH", "/git/refs/heads/main", { sha: commit.sha, force: true });
  return commit.sha;
}

const PLAN = {
  milestones: [
    {
      title: "M1 Basic operations",
      tasks: [
        { title: "Add subtract", criteria: ["subtract(a, b) is exported from calc.js", "A test covers it and npm test passes"] },
        { title: "Add multiply", criteria: ["multiply(a, b) is exported from calc.js", "A test covers it and npm test passes"] },
        { title: "Document the API in the README", criteria: ["Each exported function is listed"], blocked_by: ["Add subtract", "Add multiply"] },
      ],
    },
    { title: "M2 Later", tasks: [{ title: "Add divide", criteria: ["divide(a, b) is exported"] }] },
  ],
};

const SCENARIOS = {
  // Told to do the planned work, in the user's own words, with no mention of tools.
  next: { plan: true, prompt: "Do the next thing that needs doing in this repo. Commit and push your work." },
  // A long job: does the agent stay on the plan across several tasks?
  milestone: { plan: true, prompt: "Finish the current milestone in this repo. Commit and push your work. You may merge your own pull requests." },
  // A small job nobody planned: is it on record rather than a stray commit?
  fix: { plan: true, prompt: "Fix the typo in the README. Commit and push it." },
  // No plan: the agent should just do the job and not invent process.
  noplan: { plan: false, prompt: "Fix the typo in the README. Commit and push it." },
};

const claudeArgs = (prompt, settings) => [
  "-p", prompt,
  "--model", "claude-sonnet-5-5",
  "--strict-mcp-config",
  "--mcp-config", JSON.stringify({ mcpServers: { gam: { command: "node", args: [CLI, "mcp"] } } }),
  "--permission-mode", "acceptEdits",
  "--allowedTools", "Read,Edit,Write,Glob,Grep,Bash(git *),Bash(node *),Bash(npm *),mcp__gam__*",
  ...(settings ? ["--settings", settings] : []),
];

const hookSettings = JSON.stringify({
  hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: `node "${CLI}" hook session-start`, timeout: 15 }] }],
    Stop: [{ hooks: [{ type: "command", command: `node "${CLI}" hook stop`, timeout: 15 }] }],
  },
});

const CONDITIONS = {
  "claude-mcp": { run: (p) => ["claude", claudeArgs(p)] },
  "claude-mcp-hooks": { run: (p) => ["claude", claudeArgs(p, hookSettings)] },
  "codex-mcp": {
    run: (p) => [
      "codex",
      ["exec", "--skip-git-repo-check", "--sandbox", "workspace-write", "-c", "sandbox_workspace_write.network_access=true", "-c", `mcp_servers.gam.command="node"`, "-c", `mcp_servers.gam.args=["${CLI}","mcp"]`, "-c", 'mcp_servers.gam.default_tools_approval_mode="approve"', p],
    ],
  },
};

async function score(name, s, start, dir) {
  const [issues, pulls, refs, commits] = await Promise.all([
    api("GET", "/issues?state=all&per_page=100&since=2000-01-01T00:00:00Z"),
    api("GET", "/pulls?state=all&per_page=30"),
    api("GET", "/git/matching-refs/heads/?per_page=100"),
    api("GET", `/commits?sha=main&per_page=50`),
  ]);
  const fresh = issues.filter((i) => !i.pull_request && new Date(i.created_at) >= s.at);
  const newPulls = pulls.filter((p) => new Date(p.created_at) >= s.at);
  const linked = (p) => /^task\/\d+/.test(p.head.ref) || /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+#\d+/i.test(p.body ?? "");
  const branches = refs.map((r) => r.ref.replace("refs/heads/", "")).filter((b) => b !== "main" && !/^task\/\d+/.test(b));
  const mainNew = commits.filter((c) => c.sha !== start);
  const strayCommits = mainNew.filter((c) => !/\(#\d+\)\s*$|^Merge pull request/m.test(c.commit.message.split("\n")[0]) && !/\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+#\d+/i.test(c.commit.message));
  const tasksTouched = refs.filter((r) => /^refs\/heads\/task\/\d+/.test(r.ref)).length;
  const unplanned = fresh.filter((i) => i.labels.some((l) => l.name === "unplanned"));
  const local = sh("git", ["status", "--porcelain"], { cwd: dir }).stdout.trim();
  const unlinkedPulls = newPulls.filter((p) => !linked(p)).length;
  const offPlan = strayCommits.length + branches.length + unlinkedPulls;
  const closedTasks = (await api("GET", "/issues?state=closed&per_page=100")).filter((i) => !i.pull_request && i.milestone && i.state_reason === "completed" && new Date(i.closed_at) >= s.at);

  const r = {
    linkedPulls: newPulls.filter(linked).length,
    merged: newPulls.filter((p) => p.merged_at).length,
    unlinkedPulls,
    strayCommits: strayCommits.length,
    otherBranches: branches.length,
    taskBranches: tasksTouched,
    unplannedRecorded: unplanned.length,
    closedTasks: closedTasks.length,
    issuesCreated: fresh.length,
    uncommitted: local.split("\n").filter(Boolean).length,
  };
  let followed;
  if (name === "noplan") followed = r.issuesCreated === 0 && r.strayCommits >= 0 && mainNew.length + newPulls.length > 0;
  else if (name === "fix") followed = offPlan === 0 && r.unplannedRecorded + r.linkedPulls > 0;
  else followed = offPlan === 0 && r.linkedPulls + r.taskBranches > 0;
  return { ...r, followed };
}

for (const [condition, c] of Object.entries(CONDITIONS)) {
  for (const [name, s] of Object.entries(SCENARIOS)) {
    const id = `${condition}/${name}`;
    if (filter.length && !filter.every((f) => id.includes(f))) continue;
    const start = await reset();
    const at = new Date(Date.now() - 2000);
    if (s.plan) {
      const r = sh("node", [CLI, "plan", "-", "--repo", REPO], { input: JSON.stringify(PLAN), env: { ...process.env, GITHUB_TOKEN: token } });
      if (r.status !== 0) throw new Error(r.stderr);
      await new Promise((res) => setTimeout(res, 8000));
    }
    const planDone = new Date(Date.now() - 1000);
    const dir = mkdtempSync(join(tmpdir(), "gam-bench-"));
    sh("git", ["clone", "-q", `https://github.com/${REPO}.git`, dir]);
    writeFileSync(join(dir, ".git", "info", "exclude"), "node_modules\n");
    const [cmd, args] = c.run(s.prompt);
    const began = Date.now();
    const env = { ...process.env, GITHUB_TOKEN: token, GAM_AGENT: "" };
    delete env.GAM_AGENT;
    const run = sh(cmd, args, { cwd: dir, env, timeout: LIMIT_MS, input: "", maxBuffer: 64 * 1024 * 1024 });
    const seconds = Math.round((Date.now() - began) / 1000);
    await new Promise((res) => setTimeout(res, 5000));
    const result = { id, at: new Date().toISOString(), seconds, exit: run.status, timedOut: run.error?.code === "ETIMEDOUT", ...(await score(name, { at: planDone }, start, dir)) };
    appendFileSync("bench/results.jsonl", `${JSON.stringify(result)}\n`);
    writeFileSync(`/tmp/gam-bench-${id.replace("/", "-")}.log`, `${run.stdout}\n---\n${run.stderr}`);
    console.log(JSON.stringify(result));
    rmSync(dir, { recursive: true, force: true });
  }
}
