import { countByState, currentMilestone, deriveTasks, orderedMilestones, overallProgress, tasksIn } from "./derive.ts";
import type { Milestone, Snapshot } from "./model.ts";

const WIDTH = 720;
const PAD = 24;
const MAX_ROWS = 6;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function clip(s: string, max: number): string {
  const chars = [...s];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : s;
}

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

/** One thin bar per milestone: done, in review and in progress in steps of one hue, on a neutral track. */
function bar(x: number, y: number, w: number, parts: [string, number][], total: number): string {
  const h = 8;
  let out = `<rect class="track" x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>`;
  if (total === 0) return out;
  let at = x;
  for (const [cls, value] of parts) {
    if (value <= 0) continue;
    const pw = Math.max((value / total) * w, 4);
    const gap = at + pw >= x + w - 0.5 ? 0 : 2;
    out += `<rect class="${cls}" x="${at.toFixed(1)}" y="${y}" width="${Math.max(pw - gap, 2).toFixed(1)}" height="${h}" rx="4"/>`;
    at += pw;
  }
  return out;
}

function rowsFor(s: Snapshot): Milestone[] {
  const open = orderedMilestones(s.milestones);
  const closed = s.milestones.filter((m) => m.state === "closed").sort((a, b) => b.number - a.number);
  return [...closed.slice(0, Math.max(1, MAX_ROWS - open.length)).reverse(), ...open].slice(0, MAX_ROWS);
}

export function renderStatus(s: Snapshot): string {
  const tasks = deriveTasks(s);
  const { done, total } = overallProgress(s.milestones);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const current = currentMilestone(s);
  const rows = rowsFor(s);
  const hidden = s.milestones.length - rows.length;
  const rowHeight = 44;
  const top = 104;
  const height = top + rows.length * rowHeight + 44;

  const body = rows
    .map((m, i) => {
      const y = top + i * rowHeight;
      const isCurrent = m.number === current?.number;
      const count = m.open + m.closed;
      const c = countByState(tasksIn(tasks, m.number));
      const parts: [string, number][] = [["done", m.closed], ["review", c.in_review], ["progress", c.in_progress]];
      const right = m.state === "closed" ? "closed" : `${m.closed}/${count}`;
      const due = fmtDate(m.dueOn);
      return (
        `<text class="${isCurrent ? "name now" : "name"}" x="${PAD}" y="${y + 12}">${esc(clip(m.title, 58))}</text>` +
        `<text class="meta" x="${WIDTH - PAD}" y="${y + 12}" text-anchor="end">${due ? `due ${due} · ` : ""}${right}</text>` +
        bar(PAD, y + 20, WIDTH - PAD * 2, parts, count)
      );
    })
    .join("");

  const headline = total
    ? current
      ? `Now: ${clip(current.title, 60)}`
      : "All milestones done"
    : "No tasks yet";
  const legendY = height - 20;
  const legend = [["done", "Done"], ["review", "In review"], ["progress", "In progress"]]
    .map(([cls, label], i) => `<rect class="${cls}" x="${PAD + i * 96}" y="${legendY - 9}" width="10" height="10" rx="2"/><text class="meta" x="${PAD + i * 96 + 15}" y="${legendY}">${label}</text>`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${pct} percent done, ${done} of ${total} tasks">
<style>
text{font:13px -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,"Noto Sans KR",sans-serif;fill:#52514e}
.card{fill:#fcfcfb;stroke:#d9d8d3}
.hero{font-size:40px;font-weight:600;fill:#0b0b0b}
.sum{font-size:14px;fill:#0b0b0b}
.name{fill:#52514e}
.now{fill:#0b0b0b;font-weight:600}
.meta{font-size:12px;font-variant-numeric:tabular-nums}
.track{fill:#e8e7e3}
.done{fill:#184f95}
.review{fill:#3987e5}
.progress{fill:#86b6ef}
@media (prefers-color-scheme:dark){
text{fill:#c3c2b7}
.card{fill:#1a1a19;stroke:#383835}
.hero,.sum,.now{fill:#f0efec}
.name{fill:#c3c2b7}
.track{fill:#2c2c2a}
.done{fill:#86b6ef}
.review{fill:#3987e5}
.progress{fill:#184f95}
}
</style>
<rect class="card" x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="8"/>
<text class="hero" x="${PAD}" y="62">${pct}%</text>
<text class="sum" x="${PAD + 96}" y="46">${esc(headline)}</text>
<text class="meta" x="${PAD + 96}" y="66">${done} of ${total} tasks done across ${s.milestones.length} milestone${s.milestones.length === 1 ? "" : "s"}${hidden > 0 ? ` (${hidden} not shown)` : ""}</text>
${body}
${legend}
</svg>
`;
}
