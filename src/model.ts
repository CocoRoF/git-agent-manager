export type TaskState = "proposed" | "ready" | "blocked" | "in_progress" | "in_review" | "done" | "dropped";

export interface Milestone {
  number: number;
  title: string;
  description: string;
  state: "open" | "closed";
  dueOn: string | null;
  createdAt: string;
  open: number;
  closed: number;
  url: string;
}

export interface Issue {
  number: number;
  id: number;
  title: string;
  body: string;
  state: "open" | "closed";
  stateReason: string | null;
  labels: string[];
  milestone: number | null;
  author: string;
  /** The author has write access, so the text may be treated as instructions. */
  trusted: boolean;
  /** Open issues blocking this one. */
  blockedBy: number;
  url: string;
  updatedAt: string;
}

export interface Pull {
  number: number;
  title: string;
  body: string;
  headRef: string;
  headRepo: string | null;
  state: "open" | "closed";
  mergedAt: string | null;
  draft: boolean;
  url: string;
  createdAt: string;
}

export interface CommitRef {
  sha: string;
  /** Parent shas. A merge commit has two; its second parent's line is the merged branch. */
  parents?: string[];
  message: string;
  url: string;
  author: string;
  bot: boolean;
}

export interface Snapshot {
  owner: string;
  repo: string;
  defaultBranch: string;
  private: boolean;
  milestones: Milestone[];
  issues: Issue[];
  /** Branch names under task/. */
  branches: string[];
  pulls: Pull[];
  /** Default-branch commits since the plan began, newest first. */
  commits: CommitRef[];
  /** Goals a person gave, as issues labelled agenda. */
  agendas: Issue[];
}

export interface Config {
  /** With required, an agent's new tasks wait for a person's approval, whatever the agent asks for. */
  approval: "auto" | "required";
  /** Who may merge. With agent, gam_finish can merge a pull request once its checks pass. */
  merge: "human" | "agent";
  /** Where this repo's dashboard is served: its own Pages, or the owner's domain. */
  dashboard: string | null;
}

export interface Task {
  issue: Issue;
  state: TaskState;
  branch: string | null;
  pull: Pull | null;
  /** How a done task was proven: a merged PR, or only a closed issue. */
  evidence: "merged_pr" | "closed" | null;
  unplanned: boolean;
}

export interface Criterion {
  text: string;
  met: boolean;
}

export interface Comment {
  id: number;
  body: string;
  author: string;
  trusted: boolean;
  updatedAt: string;
}

export interface NewIssue {
  title: string;
  body: string;
  milestone?: number;
  labels?: string[];
}

export interface Tracker {
  snapshot(): Promise<Snapshot>;
  /** Reads one issue directly. Lists can lag by seconds after a change; this does not. */
  getIssue(number: number): Promise<Issue>;
  listComments(issue: number): Promise<Comment[]>;
  createComment(issue: number, body: string): Promise<Comment>;
  updateComment(id: number, body: string): Promise<void>;
  ensureLabel(name: string, color: string, description: string): Promise<void>;
  addLabels(issue: number, labels: string[]): Promise<void>;
  removeLabel(issue: number, label: string): Promise<void>;
  createMilestone(m: { title: string; description?: string; dueOn?: string }): Promise<Milestone>;
  updateMilestone(number: number, patch: { state?: "open" | "closed"; description?: string }): Promise<void>;
  createIssue(issue: NewIssue): Promise<Issue>;
  updateIssue(number: number, patch: { body?: string; state?: "open" | "closed"; stateReason?: "completed" | "not_planned" }): Promise<void>;
  addBlockedBy(issue: number, blocker: number): Promise<void>;
  /** Creates the branch. Returns false when it already exists, which is what makes a claim atomic. */
  createBranch(issue: Issue, name: string): Promise<boolean>;
  deleteBranch(name: string): Promise<void>;
  compareBranch(name: string): Promise<{ ahead: number; lastCommitAt: string | null }>;
  createPull(pull: { title: string; body: string; head: string; draft?: boolean }): Promise<Pull>;
  /** The checks on a branch's latest commit. */
  branchChecks(name: string): Promise<{ pending: string[]; failed: string[]; total: number }>;
  /** Merges and deletes the branch. Returns why not, if GitHub refuses. */
  mergePull(number: number, branch: string): Promise<string | null>;
  /** Replaces the status image on a ref that branch lists and clones never show. */
  publishStatus(svg: string): Promise<void>;
  readConfig(): Promise<Config>;
  /** Paths a task branch has changed so far. */
  branchFiles(name: string): Promise<string[]>;
}
