import { countByState, currentMilestone, deriveTasks, isFinished, orderedMilestones, overallProgress, tasksIn } from "../derive.ts";
import type { Milestone, Snapshot, Task, TaskState } from "../model.ts";
import { ViewerError, fetchSnapshot, getToken, setToken } from "./api.ts";
import { t } from "./i18n.ts";

const RECENT_KEY = "gam.repos";
const COLUMNS: TaskState[] = ["proposed", "blocked", "ready", "in_progress", "in_review", "done"];
const COLUMN_LIMIT = 8;
const SOURCE = "https://github.com/CocoRoF/git-agent-manager";

type Child = Node | string | null | undefined | false;

/** Every piece of text goes in as a text node, so nothing from an issue can become markup. */
function h(tag: string, attrs: Record<string, string | undefined> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) el.setAttribute(k, v);
  for (const c of children) if (c) el.append(c);
  return el;
}

/** Links only ever point at GitHub, even if a response says otherwise. */
function gh(url: string): string {
  return url.startsWith("https://github.com/") ? url : "#";
}

function link(url: string, ...children: Child[]): HTMLElement {
  return h("a", { href: gh(url), target: "_blank", rel: "noopener noreferrer" }, ...children);
}

const root = document.getElementById("app")!;
const tip = h("div", { class: "tip", hidden: "" });
document.body.append(tip);

function hint(el: HTMLElement, text: string): HTMLElement {
  el.setAttribute("aria-label", text);
  el.addEventListener("mousemove", (e) => {
    tip.textContent = text;
    tip.hidden = false;
    const x = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8);
    tip.style.left = `${x}px`;
    tip.style.top = `${e.clientY + 14}px`;
  });
  el.addEventListener("mouseleave", () => {
    tip.hidden = true;
  });
  return el;
}

function bar(m: Milestone, tasks: Task[]): HTMLElement {
  const total = m.open + m.closed;
  const c = countByState(tasksIn(tasks, m.number));
  const parts: [string, number, string][] = [
    ["s-done", m.closed, t.done],
    ["s-review", c.in_review, t.in_review],
    ["s-progress", c.in_progress, t.in_progress],
  ];
  const el = h("div", { class: "bar", role: "img" });
  el.setAttribute("aria-label", parts.map(([, n, label]) => `${label} ${n}`).join(", "));
  for (const [cls, n, label] of parts) {
    if (n <= 0 || total === 0) continue;
    const seg = h("i", { class: cls, style: `width:${(n / total) * 100}%` });
    el.append(hint(seg, `${label}: ${n} / ${total}`));
  }
  return el;
}

function legend(): HTMLElement {
  const item = (cls: string, label: string) => h("span", {}, h("i", { class: cls }), label);
  return h("div", { class: "legend" }, item("s-done", t.done), item("s-review", t.in_review), item("s-progress", t.in_progress));
}

function milestoneRow(m: Milestone, tasks: Task[], selected: boolean, onPick: () => void): HTMLElement {
  const total = m.open + m.closed;
  const late = m.state === "open" && !isFinished(m) && m.dueOn !== null && new Date(m.dueOn) < new Date();
  const meta = [m.dueOn ? `${t.due} ${m.dueOn.slice(0, 10)}` : "", m.state === "closed" ? t.closed : total ? `${m.closed}/${total}` : t.noTasks].filter(Boolean).join(" · ");
  const el = h(
    "button",
    { class: `ms${m.state === "closed" ? " isclosed" : ""}`, "aria-pressed": String(selected), type: "button" },
    h("div", { class: "row" }, h("span", { class: "name" }, m.title), h("span", { class: late ? "meta late" : "meta" }, late ? `${t.overdue} · ${meta}` : meta)),
    bar(m, tasks),
  );
  el.addEventListener("click", onPick);
  return el;
}

function taskCard(task: Task): HTMLElement {
  const { issue } = task;
  const tags: HTMLElement[] = [];
  for (const l of issue.labels) if (l.startsWith("role:")) tags.push(h("span", { class: "tag" }, l.slice(5)));
  if (task.state === "done") tags.push(h("span", { class: task.evidence === "merged_pr" ? "tag" : "tag warn" }, task.evidence === "merged_pr" ? t.viaPr : t.noPr));
  if (!issue.trusted) tags.push(h("span", { class: "tag warn", title: t.outsider }, `@${issue.author}`));
  const card = link(task.pull?.state === "open" ? task.pull.url : issue.url, h("span", { class: "num" }, `#${issue.number} `), issue.title);
  card.className = "task";
  if (tags.length) card.append(h("div", { class: "tags" }, ...tags));
  return card;
}

function column(state: TaskState, tasks: Task[]): HTMLElement | null {
  const mine = tasks.filter((x) => x.state === state).sort((a, b) => a.issue.number - b.issue.number);
  if (state === "proposed" && mine.length === 0) return null;
  const label = t[state];
  const col = h("div", { class: "card col" }, h("h3", {}, label, h("span", { class: "n" }, String(mine.length))));
  if (mine.length === 0) col.append(h("div", { class: "none" }, t.empty));
  const shown = state === "done" ? [...mine].reverse() : mine;
  shown.slice(0, COLUMN_LIMIT).forEach((x) => col.append(taskCard(x)));
  if (shown.length > COLUMN_LIMIT) {
    const more = h("button", { class: "more", type: "button" }, t.more(shown.length - COLUMN_LIMIT));
    more.addEventListener("click", () => {
      more.replaceWith(...shown.slice(COLUMN_LIMIT).map(taskCard));
    });
    col.append(more);
  }
  return col;
}

function topBar(repo: string | null, extra: Child[] = []): HTMLElement {
  return h(
    "div",
    { class: "top" },
    SNAPSHOT ? null : h("a", { href: "#/", class: "crumb" }, t.home),
    repo && !SNAPSHOT ? h("span", { class: "crumb" }, "/") : null,
    repo ? link(`https://github.com/${repo}`, h("span", { class: "repo" }, repo)) : null,
    h("span", { class: "spacer" }),
    ...extra,
  );
}

function renderPlan(s: Snapshot, stamp: Date, reload: () => void): void {
  const slug = `${s.owner}/${s.repo}`;
  const tasks = deriveTasks(s);
  const { done, total } = overallProgress(s.milestones);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const current = currentMilestone(s);
  const stampText = `${SNAPSHOT ? t.snapshot : t.updated} ${stamp.toLocaleString()}`;
  const extras: Child[] = [h("span", { class: "stamp" }, stampText)];
  if (!SNAPSHOT) {
    const again = h("button", { type: "button" }, t.refresh);
    again.addEventListener("click", reload);
    extras.push(again);
  }

  if (s.milestones.length === 0) {
    root.replaceChildren(
      h(
        "div",
        { class: "wrap" },
        topBar(slug, extras),
        h("div", { class: "card notice" }, h("div", { class: "big" }, t.noPlan), h("div", { class: "sub" }, t.noPlanHint)),
      ),
    );
    return;
  }

  const open = orderedMilestones(s.milestones);
  const closed = s.milestones.filter((m) => m.state === "closed").sort((a, b) => a.number - b.number);
  const ordered = [...closed, ...open];
  let selected = current?.number ?? open[0]?.number ?? closed[closed.length - 1]?.number ?? 0;

  const list = h("div", { class: "card" });
  const boardTitle = h("h2", {});
  const board = h("div", { class: "board" });

  const paint = () => {
    list.replaceChildren(
      ...ordered.map((m) =>
        milestoneRow(m, tasks, m.number === selected, () => {
          selected = m.number;
          paint();
        }),
      ),
      legend(),
    );
    const m = ordered.find((x) => x.number === selected);
    boardTitle.textContent = m ? `${t.board}: ${m.title}` : t.board;
    const inM = tasksIn(tasks, selected);
    board.replaceChildren(...COLUMNS.map((c) => column(c, inM)).filter((x): x is HTMLElement => !!x));
    if (m?.state === "closed") board.replaceChildren(h("div", { class: "card notice" }, link(m.url, t.onGithub)));
  };
  paint();

  const unplanned = tasks.filter((x) => x.unplanned);
  const unplannedDone = unplanned.filter((x) => x.issue.state === "closed").length;

  root.replaceChildren(
    h(
      "div",
      { class: "wrap" },
      topBar(slug, extras),
      h(
        "div",
        { class: "card hero" },
        h("div", { class: "pct" }, `${pct}%`),
        h(
          "div",
          { class: "what" },
          h("div", { class: "label" }, current ? t.now : ""),
          h("div", { class: "now" }, current ? current.title : t.allDone),
          h("div", { class: "sum" }, t.tasksDone(done, total, s.milestones.length)),
        ),
      ),
      h("h2", {}, t.milestones),
      list,
      boardTitle,
      board,
      unplanned.length
        ? h(
            "section",
            {},
            h("h2", {}, `${t.unplanned} · ${unplannedDone}/${unplanned.length}`),
            h("div", { class: "card col" }, h("div", { class: "none", style: "margin-bottom:10px" }, t.unplannedHint), ...[...unplanned].reverse().slice(0, 12).map(taskCard)),
          )
        : null,
      h("div", { class: "foot" }, link(SOURCE, "git-agent-manager")),
    ),
  );
}

function savedRepos(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function remember(slug: string): void {
  localStorage.setItem(RECENT_KEY, JSON.stringify([slug, ...savedRepos().filter((x) => x !== slug)].slice(0, 30)));
}

function tokenSection(): HTMLElement {
  const input = h("input", { type: "password", autocomplete: "off", placeholder: "github_pat_…", "aria-label": t.tokenTitle }) as HTMLInputElement;
  input.value = getToken();
  const msg = h("div", { class: "sub", style: "margin:8px 0 0" });
  const save = h("button", { type: "button" }, t.save);
  save.addEventListener("click", () => {
    setToken(input.value.trim());
    msg.textContent = input.value.trim() ? t.tokenSaved : "";
  });
  const clear = h("button", { type: "button" }, t.clear);
  clear.addEventListener("click", () => {
    input.value = "";
    setToken("");
    msg.textContent = "";
  });
  return h(
    "div",
    { class: "card section" },
    h("h2", {}, t.tokenTitle),
    h("p", { class: "sub" }, t.tokenHint, " ", link("https://github.com/settings/personal-access-tokens/new", t.tokenLink)),
    h("div", { class: "field" }, input, save, clear),
    msg,
  );
}

function renderHome(): void {
  const input = h("input", { placeholder: t.placeholder, "aria-label": t.openRepo, autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
  const go = () => {
    const m = /(?:github\.com\/)?([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(input.value.trim());
    if (m) location.hash = `#/${m[1]}`;
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
  });
  const open = h("button", { type: "button" }, t.open);
  open.addEventListener("click", go);

  const repos = savedRepos();
  const list = h("div", { class: "repos" });
  for (const slug of repos) {
    const remove = h("button", { type: "button", "aria-label": `${t.remove} ${slug}` }, t.remove);
    remove.addEventListener("click", () => {
      localStorage.setItem(RECENT_KEY, JSON.stringify(savedRepos().filter((x) => x !== slug)));
      renderHome();
    });
    list.append(h("div", { class: "line" }, h("a", { href: `#/${slug}` }, slug), remove));
  }

  root.replaceChildren(
    h(
      "div",
      { class: "wrap" },
      h(
        "div",
        { class: "home" },
        h("h1", {}, t.title),
        h("div", { class: "card section" }, h("h2", {}, t.openRepo), h("div", { class: "field" }, input, open)),
        repos.length ? h("div", { class: "card section" }, h("h2", {}, t.recent), list) : null,
        tokenSection(),
        h("div", { class: "foot" }, link(SOURCE, "git-agent-manager")),
      ),
    ),
  );
  input.focus();
}

function renderError(slug: string, e: unknown, reload: () => void): void {
  const kind = e instanceof ViewerError ? e.kind : "other";
  const message = { not_found: t.notFound, rate_limited: t.rateLimited, unauthorized: t.unauthorized, other: t.failed }[kind];
  const retry = h("button", { type: "button" }, t.retry);
  retry.addEventListener("click", reload);
  root.replaceChildren(
    h(
      "div",
      { class: "wrap" },
      topBar(slug),
      h("div", { class: "card notice", role: "alert" }, h("div", { class: "big" }, message), h("div", { class: "sub" }, kind === "other" && e instanceof Error ? e.message : ""), retry),
      kind === "other" ? null : h("div", { style: "margin-top:14px" }, tokenSection()),
    ),
  );
}

async function renderRepo(owner: string, repo: string): Promise<void> {
  const slug = `${owner}/${repo}`;
  const reload = () => void renderRepo(owner, repo);
  if (!root.querySelector(".hero")) root.replaceChildren(h("div", { class: "wrap" }, topBar(slug), h("div", { class: "card notice" }, t.loading)));
  try {
    const s = await fetchSnapshot(owner, repo);
    remember(slug);
    document.title = `${slug} · ${t.title}`;
    renderPlan(s, new Date(), reload);
  } catch (e) {
    renderError(slug, e, reload);
  }
}

function route(): void {
  tip.hidden = true;
  const m = /^#\/([\w.-]+)\/([\w.-]+)\/?$/.exec(location.hash);
  if (m) void renderRepo(m[1]!, m[2]!);
  else renderHome();
}

const embedded = document.getElementById("snapshot")?.textContent?.trim();
const SNAPSHOT: { snapshot: Snapshot; at: string } | null = embedded ? JSON.parse(embedded) : null;

if (SNAPSHOT) {
  document.title = `${SNAPSHOT.snapshot.owner}/${SNAPSHOT.snapshot.repo} · ${t.title}`;
  renderPlan(SNAPSHOT.snapshot, new Date(SNAPSHOT.at), () => {});
} else {
  addEventListener("hashchange", route);
  route();
}
