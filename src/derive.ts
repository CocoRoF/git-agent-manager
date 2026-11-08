import type { CommitRef, Config, Criterion, Issue, Milestone, Pull, Snapshot, Task, TaskState } from "./model.ts";

export const LABEL_BLOCKED = "blocked";
export const LABEL_PROPOSED = "proposed";
export const LABEL_UNPLANNED = "unplanned";
export const LABEL_AGENDA = "agenda";
export const ROLE_PREFIX = "role:";

const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)\b/gi;
const BRANCH = /^task\/(\d+)(?:-|$)/;
const CHECKBOX = /^(\s*[-*]\s+\[)([ xX])(\]\s+)(.*)$/;

export function branchIssue(branch: string): number | null {
  const m = BRANCH.exec(branch);
  return m ? Number(m[1]) : null;
}

export function closingIssues(body: string): number[] {
  return [...body.matchAll(CLOSING)].map((m) => Number(m[1]));
}

export function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

export function branchName(issue: { number: number; title: string }): string {
  const s = slug(issue.title);
  return s ? `task/${issue.number}-${s}` : `task/${issue.number}`;
}

export function parseCriteria(body: string): Criterion[] {
  const out: Criterion[] = [];
  for (const line of body.split("\n")) {
    const m = CHECKBOX.exec(line);
    if (m) out.push({ text: m[4]!.trim(), met: m[2] !== " " });
  }
  return out;
}

/** Ticks the checkboxes at the given 1-based positions. */
export function tickCriteria(body: string, positions: number[]): string {
  let i = 0;
  return body
    .split("\n")
    .map((line) => {
      const m = CHECKBOX.exec(line);
      if (!m) return line;
      i++;
      return positions.includes(i) ? `${m[1]}x${m[3]}${m[4]}` : line;
    })
    .join("\n");
}

function pullsFor(snapshot: Snapshot, issue: Issue): Pull[] {
  return snapshot.pulls.filter(
    (p) => branchIssue(p.headRef) === issue.number || closingIssues(p.body).includes(issue.number),
  );
}

export function deriveTask(snapshot: Snapshot, issue: Issue): Task {
  const branch = snapshot.branches.find((b) => branchIssue(b) === issue.number) ?? null;
  const pulls = pullsFor(snapshot, issue);
  const self = `${snapshot.owner}/${snapshot.repo}`.toLowerCase();
  // Anyone can open a PR from a fork that says "Closes #12". It must not make the task look taken.
  const openPull = pulls.find((p) => p.state === "open" && p.headRepo?.toLowerCase() === self) ?? null;
  const merged = pulls.find((p) => p.mergedAt) ?? null;
  const unplanned = issue.labels.includes(LABEL_UNPLANNED);

  let state: TaskState;
  if (issue.state === "closed") state = issue.stateReason === "not_planned" ? "dropped" : "done";
  else if (issue.labels.includes(LABEL_PROPOSED)) state = "proposed";
  else if (issue.labels.includes(LABEL_BLOCKED)) state = "blocked";
  else if (openPull) state = "in_review";
  else if (branch) state = "in_progress";
  else if (issue.blockedBy > 0) state = "blocked";
  else state = "ready";

  return {
    issue,
    state,
    branch,
    pull: openPull ?? merged,
    evidence: state === "done" ? (merged ? "merged_pr" : "closed") : null,
    unplanned,
  };
}

export function deriveTasks(snapshot: Snapshot): Task[] {
  return snapshot.issues.map((i) => deriveTask(snapshot, i));
}

/** Open milestones in working order: earliest due date first, then creation order. */
export function orderedMilestones(milestones: Milestone[]): Milestone[] {
  return milestones
    .filter((m) => m.state === "open")
    .sort((a, b) => {
      if (a.dueOn && b.dueOn && a.dueOn !== b.dueOn) return a.dueOn < b.dueOn ? -1 : 1;
      if (a.dueOn && !b.dueOn) return -1;
      if (!a.dueOn && b.dueOn) return 1;
      return a.number - b.number;
    });
}

export function isFinished(m: Milestone): boolean {
  return m.open === 0 && m.closed > 0;
}

/** The milestone to work on: the first open one that still has work or has no tasks yet. */
export function currentMilestone(snapshot: Snapshot): Milestone | null {
  return orderedMilestones(snapshot.milestones).find((m) => !isFinished(m)) ?? null;
}

export function tasksIn(tasks: Task[], milestone: number): Task[] {
  return tasks.filter((t) => t.issue.milestone === milestone);
}

/** Tasks in the current milestone an agent may start, best first. */
export function readyTasks(snapshot: Snapshot, tasks: Task[], role?: string): Task[] {
  const current = currentMilestone(snapshot);
  if (!current) return [];
  return tasksIn(tasks, current.number)
    .filter((t) => t.state === "ready" && t.issue.trusted)
    .filter((t) => !role || !hasRole(t) || t.issue.labels.includes(ROLE_PREFIX + role))
    .sort((a, b) => a.issue.number - b.issue.number);
}

function hasRole(t: Task): boolean {
  return t.issue.labels.some((l) => l.startsWith(ROLE_PREFIX));
}

export function countByState(tasks: Task[]): Record<TaskState, number> {
  const out: Record<TaskState, number> = { proposed: 0, ready: 0, blocked: 0, in_progress: 0, in_review: 0, done: 0, dropped: 0 };
  for (const t of tasks) out[t.state]++;
  return out;
}

export function overallProgress(milestones: Milestone[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const m of milestones) {
    done += m.closed;
    total += m.open + m.closed;
  }
  return { done, total };
}

const PR_IN_MESSAGE = /\(#(\d+)\)\s*$|^Merge pull request #(\d+)/m;

/** The task a pull request works on, if any. */
export function pullTask(p: Pick<Pull, "headRef" | "body">): number | null {
  return branchIssue(p.headRef) ?? closingIssues(p.body)[0] ?? null;
}

export interface Audit {
  checked: number;
  offPlan: CommitRef[];
}

/** Commits on the default branch that no task accounts for. Bots aren't agents following a plan, so they don't count. */
export function auditCommits(s: Snapshot): Audit {
  const commits = s.commits.filter((c) => !c.bot);
  const offPlan = commits.filter((c) => {
    if (closingIssues(c.message).length) return false;
    const m = PR_IN_MESSAGE.exec(c.message.split("\n")[0] ?? "");
    const number = Number(m?.[1] ?? m?.[2]);
    if (!number) return true;
    const pull = s.pulls.find((p) => p.number === number);
    // A PR that has aged out of the list can't be judged, so give it the benefit of the doubt.
    return pull ? pullTask(pull) === null : false;
  });
  return { checked: commits.length, offPlan };
}

const AGENDA_LINE = /^Agenda: #(\d+)\s*$/m;

export function milestoneAgenda(m: Pick<Milestone, "description">): number | null {
  const found = AGENDA_LINE.exec(m.description);
  return found ? Number(found[1]) : null;
}

export function agendaMilestones(milestones: Milestone[], agenda: number): Milestone[] {
  return milestones.filter((m) => milestoneAgenda(m) === agenda);
}

export function parseConfig(text: string): Config {
  const approval = /^approval:\s*["']?(\w+)/m.exec(text)?.[1];
  const merge = /^merge:\s*["']?(\w+)/m.exec(text)?.[1];
  const dashboard = /^dashboard:\s*["']?(https:\/\/[^\s"']+)/m.exec(text)?.[1] ?? null;
  return { approval: approval === "required" ? "required" : "auto", merge: merge === "agent" ? "agent" : "human", dashboard };
}
