import { closingIssues, branchIssue, currentMilestone, parseCriteria, deriveTask } from "./derive.ts";
import type { Issue, Snapshot } from "./model.ts";

export interface PullEvent {
  number: number;
  body: string;
  headRef: string;
  headRepo: string | null;
  authorType: string;
}

export interface Finding {
  level: "error" | "warning" | "notice";
  message: string;
}

/** What a pull request means for the plan. `issue` is the task it links to, read fresh. */
export function checkPull(s: Snapshot, pull: PullEvent, issue: Issue | null): Finding[] {
  const self = `${s.owner}/${s.repo}`.toLowerCase();
  // Plans bind the team's agents. Forks and bots have no way to claim a task.
  if (pull.authorType === "Bot" || pull.headRepo?.toLowerCase() !== self) return [];
  if (s.milestones.length === 0) return [];

  if (!issue) {
    return [{ level: "warning", message: `This pull request isn't linked to a task. Use a task/<issue>-… branch, or write "Closes #<issue>" in the description. Small work can be recorded with: gam claim --new "title"` }];
  }

  const out: Finding[] = [];
  const unplanned = issue.labels.includes("unplanned");
  if (issue.milestone === null && !unplanned) {
    out.push({ level: "warning", message: `#${issue.number} isn't in a milestone, so this work is outside the plan.` });
  }
  const current = currentMilestone(s);
  if (current && issue.milestone !== null && issue.milestone !== current.number) {
    out.push({ level: "notice", message: `#${issue.number} is outside the current milestone, "${current.title}".` });
  }
  const task = deriveTask(s, issue);
  if (task.state === "blocked" && issue.blockedBy > 0) {
    out.push({ level: "warning", message: `#${issue.number} is blocked by ${issue.blockedBy} open task(s).` });
  }
  const unmet = parseCriteria(issue.body).filter((c) => !c.met);
  if (unmet.length) {
    out.push({ level: "warning", message: `#${issue.number} has ${unmet.length} done-when item(s) not ticked: ${unmet.map((c) => c.text).join("; ")}` });
  }
  return out;
}

export function linkedIssue(pull: PullEvent): number | null {
  return branchIssue(pull.headRef) ?? closingIssues(pull.body)[0] ?? null;
}
