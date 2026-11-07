import type { Comment, Config, Issue, Milestone, NewIssue, Pull, Snapshot, Tracker } from "../src/model.ts";

/** An in-memory tracker that follows the GitHub rules the code relies on. */
export class FakeTracker implements Tracker {
  milestones: Milestone[] = [];
  issues: Issue[] = [];
  branches = new Map<string, { ahead: number; lastCommitAt: string | null }>();
  pulls: Pull[] = [];
  comments = new Map<number, Comment[]>();
  private seq = 0;
  private commentSeq = 0;

  async snapshot(): Promise<Snapshot> {
    for (const m of this.milestones) {
      const mine = this.issues.filter((i) => i.milestone === m.number);
      m.open = mine.filter((i) => i.state === "open").length;
      m.closed = mine.filter((i) => i.state === "closed").length;
    }
    return structuredClone({
      owner: "o",
      repo: "r",
      defaultBranch: "main",
      private: false,
      milestones: this.milestones,
      issues: this.issues,
      branches: [...this.branches.keys()],
      pulls: this.pulls,
      commits: [],
      agendas: this.issues.filter((i) => i.labels.includes("agenda")),
    });
  }

  async getIssue(number: number): Promise<Issue> {
    return structuredClone(this.find(number));
  }

  async listComments(issue: number): Promise<Comment[]> {
    return structuredClone(this.comments.get(issue) ?? []);
  }

  addComment(issue: number, body: string, trusted = true, author = "me"): Comment {
    const c: Comment = { id: ++this.commentSeq, body, author, trusted, updatedAt: new Date().toISOString() };
    this.comments.set(issue, [...(this.comments.get(issue) ?? []), c]);
    return c;
  }

  async createComment(issue: number, body: string): Promise<Comment> {
    return this.addComment(issue, body);
  }

  async updateComment(id: number, body: string): Promise<void> {
    for (const list of this.comments.values()) {
      const c = list.find((x) => x.id === id);
      if (c) c.body = body;
    }
  }

  async ensureLabel(): Promise<void> {}

  private find(n: number): Issue {
    const i = this.issues.find((x) => x.number === n);
    if (!i) throw new Error(`no issue ${n}`);
    return i;
  }

  async addLabels(issue: number, labels: string[]): Promise<void> {
    this.find(issue).labels.push(...labels);
  }

  async removeLabel(issue: number, label: string): Promise<void> {
    const i = this.find(issue);
    i.labels = i.labels.filter((l) => l !== label);
  }

  async createMilestone(m: { title: string; description?: string; dueOn?: string }): Promise<Milestone> {
    const ms: Milestone = { number: this.milestones.length + 1, title: m.title, description: m.description ?? "", state: "open", dueOn: m.dueOn ?? null, createdAt: "2026-01-01T00:00:00Z", open: 0, closed: 0, url: "" };
    this.milestones.push(ms);
    return structuredClone(ms);
  }

  async updateMilestone(number: number, patch: { state?: "open" | "closed"; description?: string }): Promise<void> {
    Object.assign(this.milestones.find((m) => m.number === number)!, patch);
  }

  seed(partial: Partial<Issue> & { title: string }): Issue {
    const n = ++this.seq;
    const issue: Issue = { number: n, id: 1000 + n, body: "", state: "open", stateReason: null, labels: [], milestone: null, author: "me", trusted: true, blockedBy: 0, url: `https://x/${n}`, updatedAt: new Date().toISOString(), ...partial };
    this.issues.push(issue);
    return issue;
  }

  async createIssue(i: NewIssue): Promise<Issue> {
    return structuredClone(this.seed({ title: i.title, body: i.body, milestone: i.milestone ?? null, labels: i.labels ?? [] }));
  }

  async updateIssue(number: number, patch: { body?: string; state?: "open" | "closed"; stateReason?: "completed" | "not_planned" }): Promise<void> {
    const i = this.find(number);
    if (patch.body !== undefined) i.body = patch.body;
    if (patch.state) i.state = patch.state;
    if (patch.stateReason) i.stateReason = patch.stateReason;
  }

  async addBlockedBy(issue: number): Promise<void> {
    this.find(issue).blockedBy++;
  }

  async createBranch(_issue: Issue, name: string): Promise<boolean> {
    if (this.branches.has(name)) return false;
    this.branches.set(name, { ahead: 0, lastCommitAt: null });
    return true;
  }

  async deleteBranch(name: string): Promise<void> {
    this.branches.delete(name);
  }

  async compareBranch(name: string): Promise<{ ahead: number; lastCommitAt: string | null }> {
    return this.branches.get(name) ?? { ahead: 0, lastCommitAt: null };
  }

  async createPull(p: { title: string; body: string; head: string }): Promise<Pull> {
    const pull: Pull = { number: 900 + this.pulls.length, title: p.title, body: p.body, headRef: p.head, headRepo: "o/r", state: "open", mergedAt: null, draft: false, url: `https://x/pull/${this.pulls.length}` };
    this.pulls.push(pull);
    return structuredClone(pull);
  }

  published: string[] = [];
  config: Config = { approval: "auto" };
  files = new Map<string, string[]>();

  async readConfig(): Promise<Config> {
    return this.config;
  }

  async branchFiles(name: string): Promise<string[]> {
    return this.files.get(name) ?? [];
  }

  async publishStatus(svg: string): Promise<void> {
    this.published.push(svg);
  }
}
