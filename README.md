# git-agent-manager

Connect once, and any coding agent working in your repo follows a milestone plan, while progress shows up on a live dashboard.

**Status: early development.** The design is in [docs/PLAN.md](docs/PLAN.md) (Korean). Nothing is ready to install yet.

## The idea

Nothing new to learn, and nothing extra in your repo.

- **A milestone is a GitHub Milestone. A task is a GitHub Issue.** No new branch, file format, database or account. Repos that already use milestones work right away.
- **State is computed, not stored.** A task with a branch is in progress, one with an open PR is in review, and one closed by a merged PR is done.
- **Agents get six small tools** over MCP or a CLI: status, plan, claim, update, finish, block. Any agent can use them.
- **Going off plan isn't blocked, it's visible.** Small unplanned work takes one call, and it shows up on the dashboard as unplanned.
- **Remove it and you keep ordinary issues and milestones.**

## License

[Apache 2.0](LICENSE)
