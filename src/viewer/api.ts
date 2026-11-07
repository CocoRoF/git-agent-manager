import { isFinished, orderedMilestones, overallProgress } from "../derive.ts";
import type { Snapshot } from "../model.ts";
import { loadSnapshot, toMilestone } from "../snapshot.ts";

const API = "https://api.github.com";
const TOKEN_KEY = "gam.token";
const CACHE_PREFIX = "gam.etag.";

export class ViewerError extends Error {
  readonly kind: "not_found" | "rate_limited" | "unauthorized" | "other";
  constructor(kind: ViewerError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setToken(token: string): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

interface Cached {
  etag: string;
  body: unknown;
  next: string | null;
}

function readCache(url: string): Cached | null {
  try {
    return JSON.parse(sessionStorage.getItem(CACHE_PREFIX + url) ?? "null");
  } catch {
    return null;
  }
}

function writeCache(url: string, value: Cached): void {
  try {
    sessionStorage.setItem(CACHE_PREFIX + url, JSON.stringify(value));
  } catch {
    // Storage is full. Caching only saves API calls, so carry on without it.
  }
}

/** A 304 doesn't count against the rate limit, and anonymous visitors only get 60 calls an hour. */
async function fetchPage(url: string): Promise<{ body: any; next: string | null }> {
  const cached = readCache(url);
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cached) headers["If-None-Match"] = cached.etag;

  const res = await fetch(url, { headers });
  if (res.status === 304 && cached) return cached;
  if (res.status === 404) throw new ViewerError("not_found", "not found");
  if (res.status === 401) throw new ViewerError("unauthorized", "bad token");
  if (res.status === 403 || res.status === 429) {
    if (res.headers.get("x-ratelimit-remaining") === "0" || res.status === 429) throw new ViewerError("rate_limited", "rate limited");
    throw new ViewerError("unauthorized", "forbidden");
  }
  if (!res.ok) throw new ViewerError("other", `GitHub ${res.status}`);

  const body = await res.json();
  const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1] ?? null;
  const etag = res.headers.get("etag");
  if (etag) writeCache(url, { etag, body, next });
  return { body, next };
}

export interface RepoSummary {
  done: number;
  total: number;
  current: string | null;
}

/** One call per repo, so a page of many repos stays cheap. */
export async function fetchSummary(slug: string): Promise<RepoSummary> {
  const { body } = await fetchPage(`${API}/repos/${slug}/milestones?state=all&per_page=100`);
  const milestones = (body as any[]).map(toMilestone);
  const { done, total } = overallProgress(milestones);
  const current = orderedMilestones(milestones).find((m) => !isFinished(m));
  return { done, total, current: current?.title ?? null };
}

export function fetchSnapshot(owner: string, repo: string): Promise<Snapshot> {
  return loadSnapshot(
    owner,
    repo,
    async (path) => (await fetchPage(API + path)).body,
    async (path, limit = 1000) => {
      const out: any[] = [];
      let next: string | null = `${API}${path}${path.includes("?") ? "&" : "?"}per_page=100`;
      while (next && out.length < limit) {
        const page: { body: any[]; next: string | null } = await fetchPage(next);
        out.push(...page.body);
        next = page.next;
      }
      return out;
    },
  );
}
