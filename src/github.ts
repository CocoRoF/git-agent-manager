import type { Comment, Config, Issue, Milestone, NewIssue, Pull, Snapshot, Tracker } from "./model.ts";
import { parseConfig } from "./derive.ts";
import { TRUSTED, loadSnapshot, toIssue, toMilestone, toPull } from "./snapshot.ts";

const API = "https://api.github.com";
const RETRIES = 4;
const MAX_WAIT_MS = 60_000;

/** How long to wait before retrying, or null if the response should stand. */
function retryDelay(res: Response, json: Json, attempt: number): number | null {
  const after = Number(res.headers.get("retry-after"));
  const limited = res.status === 429 || (res.status === 403 && (after > 0 || /secondary rate limit/i.test(json?.message ?? "")));
  if (limited) return Math.min(after > 0 ? after * 1000 : 2000 * 2 ** attempt, MAX_WAIT_MS);
  if (res.status === 502 || res.status === 503 || res.status === 504) return 1000 * 2 ** attempt;
  return null;
}

export class GitHubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Json = any;

function toComment(c: Json): Comment {
  return {
    id: c.id,
    body: c.body ?? "",
    author: c.user?.login ?? "ghost",
    trusted: TRUSTED.has(c.author_association),
    updatedAt: c.updated_at,
  };
}

export class GitHubTracker implements Tracker {
  readonly owner: string;
  readonly repo: string;
  private readonly token: string;
  private defaultBranch: string | null = null;

  constructor(owner: string, repo: string, token: string) {
    this.owner = owner;
    this.repo = repo;
    this.token = token;
  }

  private async request(method: string, path: string, body?: unknown): Promise<{ status: number; json: Json; headers: Headers }> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "git-agent-manager",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let json: Json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { message: text.slice(0, 200) };
      }
      const wait = attempt < RETRIES ? retryDelay(res, json, attempt) : null;
      if (wait === null) return { status: res.status, json, headers: res.headers };
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  private async call(method: string, path: string, body?: unknown): Promise<Json> {
    const { status, json } = await this.request(method, path, body);
    if (status >= 400) throw new GitHubError(status, `GitHub ${method} ${path}: ${status} ${json?.message ?? ""}`.trim());
    return json;
  }

  private async paged(path: string, limit = 1000): Promise<Json[]> {
    const out: Json[] = [];
    let next: string | null = `${path}${path.includes("?") ? "&" : "?"}per_page=100`;
    while (next && out.length < limit) {
      const { status, json, headers } = await this.request("GET", next);
      if (status >= 400) throw new GitHubError(status, `GitHub GET ${path}: ${status} ${json?.message ?? ""}`.trim());
      out.push(...json);
      next = /<([^>]+)>;\s*rel="next"/.exec(headers.get("link") ?? "")?.[1] ?? null;
    }
    return out;
  }

  private get base(): string {
    return `/repos/${this.owner}/${this.repo}`;
  }

  async snapshot(): Promise<Snapshot> {
    const snapshot = await loadSnapshot(this.owner, this.repo, (path) => this.call("GET", path), (path, limit) => this.paged(path, limit));
    this.defaultBranch = snapshot.defaultBranch;
    return snapshot;
  }

  async getIssue(number: number): Promise<Issue> {
    return toIssue(await this.call("GET", `${this.base}/issues/${number}`));
  }

  async listComments(issue: number): Promise<Comment[]> {
    return (await this.paged(`${this.base}/issues/${issue}/comments`, 300)).map(toComment);
  }

  async createComment(issue: number, body: string): Promise<Comment> {
    return toComment(await this.call("POST", `${this.base}/issues/${issue}/comments`, { body }));
  }

  async updateComment(id: number, body: string): Promise<void> {
    await this.call("PATCH", `${this.base}/issues/comments/${id}`, { body });
  }

  async ensureLabel(name: string, color: string, description: string): Promise<void> {
    const { status, json } = await this.request("POST", `${this.base}/labels`, { name, color, description });
    if (status >= 400 && status !== 422) throw new GitHubError(status, `GitHub label ${name}: ${json?.message ?? status}`);
  }

  async addLabels(issue: number, labels: string[]): Promise<void> {
    await this.call("POST", `${this.base}/issues/${issue}/labels`, { labels });
  }

  async removeLabel(issue: number, label: string): Promise<void> {
    const { status, json } = await this.request("DELETE", `${this.base}/issues/${issue}/labels/${encodeURIComponent(label)}`);
    if (status >= 400 && status !== 404) throw new GitHubError(status, `GitHub label ${label}: ${json?.message ?? status}`);
  }

  async createMilestone(m: { title: string; description?: string; dueOn?: string }): Promise<Milestone> {
    return toMilestone(await this.call("POST", `${this.base}/milestones`, { title: m.title, description: m.description, due_on: m.dueOn }));
  }

  async updateMilestone(number: number, patch: { state?: "open" | "closed"; description?: string }): Promise<void> {
    await this.call("PATCH", `${this.base}/milestones/${number}`, patch);
  }

  async createIssue(issue: NewIssue): Promise<Issue> {
    return toIssue(await this.call("POST", `${this.base}/issues`, issue));
  }

  async updateIssue(number: number, patch: { body?: string; state?: "open" | "closed"; stateReason?: "completed" | "not_planned" }): Promise<void> {
    await this.call("PATCH", `${this.base}/issues/${number}`, { body: patch.body, state: patch.state, state_reason: patch.stateReason });
  }

  async addBlockedBy(issue: number, blocker: number): Promise<void> {
    const raw = await this.call("GET", `${this.base}/issues/${blocker}`);
    await this.call("POST", `${this.base}/issues/${issue}/dependencies/blocked_by`, { issue_id: raw.id });
  }

  private async graphql(query: string, variables: Record<string, unknown>): Promise<Json> {
    return (await this.request("POST", "/graphql", { query, variables })).json;
  }

  async createBranch(issue: Issue, name: string): Promise<boolean> {
    const branch = this.defaultBranch ?? (await this.call("GET", this.base)).default_branch;
    const head = await this.call("GET", `${this.base}/git/ref/heads/${branch}`);
    const sha = head.object.sha;

    // A linked branch shows up on the issue's Development panel, so try that first.
    const ids = await this.graphql(
      "query($o:String!,$n:String!,$i:Int!){repository(owner:$o,name:$n){id issue(number:$i){id}}}",
      { o: this.owner, n: this.repo, i: issue.number },
    );
    const repositoryId = ids?.data?.repository?.id;
    const issueId = ids?.data?.repository?.issue?.id;
    if (repositoryId && issueId) {
      const linked = await this.graphql(
        "mutation($i:ID!,$o:GitObjectID!,$r:ID!,$n:String!){createLinkedBranch(input:{issueId:$i,oid:$o,repositoryId:$r,name:$n}){linkedBranch{ref{name}}}}",
        { i: issueId, o: sha, r: repositoryId, n: name },
      );
      if (linked?.data?.createLinkedBranch?.linkedBranch) return true;
    }

    const { status, json } = await this.request("POST", `${this.base}/git/refs`, { ref: `refs/heads/${name}`, sha });
    if (status === 201) return true;
    if (status === 422) return false;
    throw new GitHubError(status, `GitHub create branch ${name}: ${json?.message ?? status}`);
  }

  async deleteBranch(name: string): Promise<void> {
    const { status, json } = await this.request("DELETE", `${this.base}/git/refs/heads/${name}`);
    if (status >= 400 && status !== 422) throw new GitHubError(status, `GitHub delete branch ${name}: ${json?.message ?? status}`);
  }

  async compareBranch(name: string): Promise<{ ahead: number; lastCommitAt: string | null }> {
    const branch = this.defaultBranch ?? (await this.call("GET", this.base)).default_branch;
    const { status, json } = await this.request("GET", `${this.base}/compare/${encodeURIComponent(branch)}...${encodeURIComponent(name)}?per_page=1`);
    if (status === 404) return { ahead: 0, lastCommitAt: null };
    if (status >= 400) throw new GitHubError(status, `GitHub compare ${name}: ${json?.message ?? status}`);
    const last = json.commits?.[json.commits.length - 1];
    return { ahead: json.ahead_by ?? 0, lastCommitAt: last?.commit?.committer?.date ?? null };
  }

  async createPull(pull: { title: string; body: string; head: string; draft?: boolean }): Promise<Pull> {
    const base = this.defaultBranch ?? (await this.call("GET", this.base)).default_branch;
    return toPull(await this.call("POST", `${this.base}/pulls`, { ...pull, base }));
  }

  async branchChecks(name: string): Promise<{ pending: string[]; failed: string[]; total: number }> {
    const { check_runs: runs } = await this.call("GET", `${this.base}/commits/${encodeURIComponent(`heads/${name}`)}/check-runs?per_page=100`);
    const ok = new Set(["success", "neutral", "skipped"]);
    return {
      total: runs.length,
      pending: runs.filter((r: Json) => r.status !== "completed").map((r: Json) => r.name),
      failed: runs.filter((r: Json) => r.status === "completed" && !ok.has(r.conclusion)).map((r: Json) => r.name),
    };
  }

  async mergePull(number: number, branch: string): Promise<string | null> {
    const { status, json } = await this.request("PUT", `${this.base}/pulls/${number}/merge`, { merge_method: "squash" });
    if (status >= 400) return json?.message ?? `GitHub said ${status}`;
    await this.deleteBranch(branch);
    return null;
  }

  async publishStatus(svg: string): Promise<void> {
    const blob = await this.call("POST", `${this.base}/git/blobs`, { content: svg, encoding: "utf-8" });
    const tree = await this.call("POST", `${this.base}/git/trees`, { tree: [{ path: "status.svg", mode: "100644", type: "blob", sha: blob.sha }] });
    const commit = await this.call("POST", `${this.base}/git/commits`, { message: "Update status", tree: tree.sha, parents: [] });
    const { status } = await this.request("PATCH", `${this.base}/git/refs/gam/status`, { sha: commit.sha, force: true });
    if (status >= 400) await this.call("POST", `${this.base}/git/refs`, { ref: "refs/gam/status", sha: commit.sha });
  }

  async readConfig(): Promise<Config> {
    return parseConfig((await this.readFile(".github/gam.yml"))?.text ?? "");
  }

  async branchFiles(name: string): Promise<string[]> {
    const branch = this.defaultBranch ?? (await this.call("GET", this.base)).default_branch;
    const { status, json } = await this.request("GET", `${this.base}/compare/${encodeURIComponent(branch)}...${encodeURIComponent(name)}?per_page=1`);
    if (status >= 400) return [];
    return (json.files ?? []).map((f: Json) => String(f.filename));
  }

  async readFile(path: string): Promise<{ text: string; sha: string } | null> {
    const { status, json } = await this.request("GET", `${this.base}/contents/${path}`);
    if (status === 404) return null;
    if (status >= 400) throw new GitHubError(status, `GitHub read ${path}: ${json?.message ?? status}`);
    return { text: Buffer.from(json.content, "base64").toString("utf8"), sha: json.sha };
  }

  async writeFile(path: string, text: string, branch: string, message: string, sha?: string): Promise<void> {
    await this.call("PUT", `${this.base}/contents/${path}`, { message, content: Buffer.from(text, "utf8").toString("base64"), branch, sha });
  }

  async branchFromDefault(name: string): Promise<string> {
    const repo = await this.call("GET", this.base);
    const head = await this.call("GET", `${this.base}/git/ref/heads/${repo.default_branch}`);
    const { status, json } = await this.request("POST", `${this.base}/git/refs`, { ref: `refs/heads/${name}`, sha: head.object.sha });
    if (status >= 400 && status !== 422) throw new GitHubError(status, `GitHub create branch ${name}: ${json?.message ?? status}`);
    return repo.default_branch;
  }
}
