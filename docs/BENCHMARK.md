# Plan adherence benchmark

Does connecting git-agent-manager actually change what agents do? No published data covers this, so we measured it. Measured 2026-11-07. The repo pointer was reworded after the run to add the line about small jobs.

## Method

`bench/run.mjs` resets a scratch repo to a small calculator library with the same plan each time, then runs an agent in a fresh clone with a short prompt that never mentions the tools. It scores the run from GitHub's state afterwards, not from what the agent reported.

| Scenario | Prompt | Counts as followed |
|---|---|---|
| next | "Do the next thing that needs doing in this repo. Commit and push your work." | Work is on a task branch or a linked PR, with no stray commits |
| milestone | "Finish the current milestone in this repo. Commit and push your work." | Same |
| fix | "Fix the typo in the README. Commit and push it." | Same, and the fix is recorded as a task |
| noplan | The same typo fix, in a repo with no plan | The agent creates no issues: no invented process |

Claude Code ran `claude-sonnet-5-5`. Codex ran its default model, `gpt-6.1-sol`. Each cell is two runs per scenario. Raw results are in [bench/results.jsonl](../bench/results.jsonl).

## Results

Runs that followed the plan, out of runs:

| Setup | In repos with a plan | No plan, no invented process |
|---|---|---|
| Claude Code, MCP | 6/6 | 2/2 |
| Claude Code, MCP and hooks | 6/6 | 2/2 |
| Codex, MCP only | 0/6 | 2/2 |
| Codex, MCP and global instructions | 6/6 | 2/2 |
| Codex, MCP and `AGENTS.md` in the repo (what `connect` sets up) | 6/6 | 0/2 |

Finishing the milestone, where agents may merge (`merge: agent`):

| Setup | All 3 tasks merged | Milestone closed |
|---|---|---|
| Claude Code, MCP | 1/2 | 1/2 |
| Claude Code, MCP and hooks | 2/2 | 1/2 |
| Codex, global instructions | 2/2 | 2/2 |
| Codex, `AGENTS.md` in the repo | 2/2 | 2/2 |

## What we learned

- **Claude Code follows from MCP alone.** It reads the server's instructions.
- **Codex needs an instructions file.** With MCP alone it looked for `AGENTS.md`, found none, and committed straight to `main` in 5 of 6 runs. A short pointer, either in the repo's `AGENTS.md` or in Codex's global file, took that to zero stray commits. `connect` works per repo, so it adds the pointer to the repo.
- **A repo pointer makes agents record even plan-less work.** In a repo with the pointer and no plan, Codex recorded the typo as a task in both runs. Connected repos are meant to be planned, so that's the intended behaviour there.
- **The hooks made no measurable difference here.** These jobs were short, and agents were already following. The hooks may matter more in long sessions, which this doesn't test.
- **Merging is what stops long runs.** Before agents had a way to merge, Claude Code's milestone run stopped at its first PR, because the next task depended on it. That's why `merge: agent` exists. Even with it, one Claude Code run stopped at two open PRs, saying that merging went beyond being asked to commit and push.

## Limits

- Two runs per cell is a small sample.
- The longest run took about five minutes on a tiny repo. Drift over long sessions in large repos isn't measured, and that's where we'd most expect it.
- Each agent ran on one model only. Cursor and Gemini weren't tested.
- Our first round had to be thrown out. Codex's sandbox couldn't start on the test host, and a permission setting stopped Claude Code. Those runs aren't in the results. Codex now runs with its sandbox off, in a throwaway clone.
- The Codex MCP-only milestone run that did call the tools was scored as not followed because of how its merges were titled, which has since been fixed. Its work was linked, so 0/6 slightly understates it. The other five runs are clear.
