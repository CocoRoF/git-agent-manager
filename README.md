# git-agent-manager

<!-- gam:start -->
[![Plan progress](https://raw.githubusercontent.com/CocoRoF/git-agent-manager/refs/gam/status/status.svg)](https://cocorof.github.io/git-agent-manager/#/CocoRoF/git-agent-manager)
<!-- gam:end -->

Connect once, and any coding agent working in your repo follows a milestone plan, while progress shows up on a live dashboard.

[한국어](README_ko.md)

Nothing new to learn, and nothing extra in your repo:

- **A milestone is a GitHub Milestone. A task is a GitHub Issue.** There's no new branch, file format, database or account. Repos that already use milestones work right away.
- **State is computed, not stored.** A task with a branch is in progress, one with an open PR is in review, and one closed by a merged PR is done. It can't drift out of sync.
- **You stay in the screens you know.** Reorder or comment on an issue from your phone, and agents see it on their next call.
- **Remove it and you keep ordinary issues and milestones.**

## Quick start

In a GitHub repo, with Node 20 or later:

```bash
npx github:CocoRoF/git-agent-manager
```

That's the whole setup. It:

1. Connects Claude Code, Codex, Cursor and Gemini if you have them. This is per machine, so it then works in every repo.
2. Uses the GitHub login you already have (`GITHUB_TOKEN`, `gh`, or git credentials).
3. Adds a short block to Codex's and Gemini's own global instruction files, and two small hooks to Claude Code. Your repo isn't touched, and your own text in those files stays.
4. Offers a pull request that adds the progress card to your README and a small workflow that keeps it current. You can say no.

Then just ask your agent for what you want:

> Plan out a billing system for this repo, then start on it.

## How agents use it

Agents get six small tools, about 1,000 tokens in all, over MCP or the `gam` CLI.

| Tool | What it does |
|---|---|
| `gam_status` | Where the plan stands, and what to do next |
| `gam_plan` | Creates milestones and tasks, or closes finished milestones |
| `gam_claim` | Takes a task and returns its branch and done-when list |
| `gam_update` | Adds a line of progress to a single comment on the issue |
| `gam_finish` | Submits evidence and opens a PR that closes the issue |
| `gam_block` | Marks a task blocked and says what's needed from a person |

Every result ends with a `next:` line. That's how agents stay on track without long instruction files.

**Agents can't take the same task.** Claiming creates the task's branch, and GitHub lets only one caller create a given branch. Twenty agents racing for one task produces one winner.

**Small work stays small.** `gam_claim` with `new` records an unplanned fix in one call, so nobody needs to edit the plan to fix a typo.

## The dashboard

![The dashboard for this repo: overall progress, milestones, and a task board](docs/images/dashboard.png)

Open any repo at `https://cocorof.github.io/git-agent-manager/#/owner/repo`. [Here's this one](https://cocorof.github.io/git-agent-manager/#/CocoRoF/git-agent-manager).

- It's one static page that reads straight from the GitHub API. Nothing is hosted per repo, and it doesn't touch your repo's Pages.
- Viewing rights are GitHub's. Public repos open without logging in. For private ones, paste a read-only token (it stays in your browser), or run `gam dashboard` to get a local HTML file.
- It shows commits that went around the plan, unplanned work, and whether each finished task was proven by a merged PR.

The README card lives on a hidden ref (`refs/gam/status`), so it doesn't appear in your branch list, clones, or commit history. Private repos get a link instead, because an anonymous image request can't read them.

## Staying on plan

Going off plan is never blocked by default. It's made visible. You choose how far to go:

| Level | What it adds | Where it works |
|---|---|---|
| Guidance | MCP instructions and `next:` lines | Everywhere |
| Audit | Commits with no task are counted on the dashboard | Everywhere |
| Hooks | Claude Code gets the plan at session start, and is asked once about untracked work | Claude Code |
| PR check | A warning on PRs with no task, unmet criteria or open blockers | Any repo with the workflow |
| Merge block | Set the check as required, with `mode: strict` | Public repos, or GitHub Pro and up |

### Does it work?

We ran fixed jobs on a small scratch repo and scored the result from GitHub, not from what the agent said. With the setup above, in repos with a plan:

| Agent | Work stayed on the plan |
|---|---|
| Claude Code | 12 of 12 runs |
| Codex | 6 of 6 runs |
| Codex with MCP alone, no instructions file | 0 of 6 runs |

These are short jobs on a tiny repo, a few runs each. Long sessions in big repos aren't measured yet. [Details and method](docs/BENCHMARK.md).

### Settings

All optional, in `.github/gam.yml`:

```yaml
approval: required  # new tasks from agents wait until a person removes the "proposed" label
merge: agent        # gam_finish may merge a PR once its checks pass
```

## Agendas

Hand agents a goal in one sentence:

```bash
gam agenda "Analyze three competitors and propose next quarter's pricing"
```

The next agent to check status breaks it into milestones and tasks. With roles (`role:*` labels and the `GAM_ROLE` variable), a team of agents picks up the work meant for each of them, and they're warned when their branches touch the same files. The agenda closes itself when its milestones do.

## Security

On a public repo, anyone can open an issue, so an issue is a way to try to steer your agent.

- **Only tasks in a milestone count**, and setting a milestone needs triage access.
- **Issues and comments from people without write access are never handed over as work.** Their comments are left out and only counted.
- **Issue text is marked as data** in everything agents receive.
- **The dashboard builds its page from text nodes** under a strict Content Security Policy, and only ever calls `api.github.com`.
- **Plans on public repos are public.** Keep secrets out of issues.

## Limits

- GitHub only for now. The core sits behind one interface, and GitLab and Gitea have the same concepts.
- Only people and agents with write access can claim tasks.
- Cursor has no global instructions file, so it relies on MCP alone. Use `--agents-md` to add a pointer to the repo. Cursor and Gemini haven't been through the benchmark.
- Agents using the same GitHub account all appear as you. Each signs its progress comment with its own name, and `GAM_AGENT` sets that name.

## Develop

```bash
npm ci
npm test
npm run build
GAM_E2E=1 GAM_E2E_REPO=you/scratch-repo npm run test:e2e   # wipes that repo's plan
```

`dist/` is committed, because `npx github:…` and the Action both run from it. The design is in [docs/PLAN.md](docs/PLAN.md) (Korean).

## License

[Apache 2.0](LICENSE)
