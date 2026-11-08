import type { Issue, Milestone, Pull, Snapshot } from "./model.ts";

type Json = any;

export const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export function toMilestone(m: Json): Milestone {
  return {
    number: m.number,
    title: m.title,
    description: m.description ?? "",
    state: m.state,
    dueOn: m.due_on,
    createdAt: m.created_at,
    open: m.open_issues,
    closed: m.closed_issues,
    url: m.html_url,
  };
}

export function toIssue(i: Json): Issue {
  return {
    number: i.number,
    id: i.id,
    title: i.title,
    body: i.body ?? "",
    state: i.state,
    stateReason: i.state_reason ?? null,
    labels: (i.labels ?? []).map((l: Json) => (typeof l === "string" ? l : l.name)),
    milestone: i.milestone?.number ?? null,
    author: i.user?.login ?? "ghost",
    trusted: TRUSTED.has(i.author_association),
    blockedBy: i.issue_dependencies_summary?.blocked_by ?? 0,
    url: i.html_url,
    updatedAt: i.updated_at,
  };
}

export function toPull(p: Json): Pull {
  return {
    number: p.number,
    title: p.title,
    body: p.body ?? "",
    headRef: p.head?.ref ?? "",
    headRepo: p.head?.repo?.full_name ?? null,
    state: p.state,
    mergedAt: p.merged_at ?? null,
    draft: !!p.draft,
    url: p.html_url,
    createdAt: p.created_at,
  };
}

/** Reads a whole plan through the given GET helpers, so the CLI and the browser see the same thing. */
export async function loadSnapshot(
  owner: string,
  repo: string,
  get: (path: string) => Promise<Json>,
  paged: (path: string, limit?: number) => Promise<Json[]>,
): Promise<Snapshot> {
  const base = `/repos/${owner}/${repo}`;
  const [info, milestones, unplanned, agendas, refs, openPulls, recentPulls] = await Promise.all([
    get(base),
    paged(`${base}/milestones?state=all`),
    paged(`${base}/issues?state=all&labels=unplanned`, 100),
    paged(`${base}/issues?state=all&labels=agenda`, 100),
    paged(`${base}/git/matching-refs/heads/task/`),
    paged(`${base}/pulls?state=open`),
    // Enough to prove how recently closed tasks were closed. Older ones show as closed without a PR.
    get(`${base}/pulls?state=closed&sort=updated&direction=desc&per_page=100`),
  ]);

  // Commits from before there was a plan can't have gone around it.
  const started = milestones.map((m: Json) => String(m.created_at)).sort()[0];
  const commits = started ? await get(`${base}/commits?sha=${encodeURIComponent(info.default_branch)}&since=${encodeURIComponent(started)}&per_page=100`) : [];

  const open = milestones.filter((m: Json) => m.state === "open");
  const issueLists = await Promise.all(open.map((m: Json) => paged(`${base}/issues?state=all&milestone=${m.number}`)));
  const byNumber = new Map<number, Issue>();
  for (const raw of [...issueLists.flat(), ...unplanned]) {
    if (!raw.pull_request) byNumber.set(raw.number, toIssue(raw));
  }

  return {
    owner,
    repo,
    defaultBranch: info.default_branch,
    private: info.private,
    milestones: milestones.map(toMilestone),
    issues: [...byNumber.values()],
    branches: refs.map((r: Json) => String(r.ref).replace("refs/heads/", "")),
    pulls: [...openPulls, ...recentPulls].map(toPull),
    agendas: agendas.filter((i: Json) => !i.pull_request).map(toIssue),
    commits: commits.map((c: Json) => ({
      sha: c.sha,
      parents: (c.parents ?? []).map((p: Json) => String(p.sha)),
      message: c.commit?.message ?? "",
      url: c.html_url,
      author: c.author?.login ?? c.commit?.author?.name ?? "unknown",
      bot: c.author?.type === "Bot" || /\[bot\]$/.test(c.commit?.author?.name ?? ""),
    })),
  };
}
