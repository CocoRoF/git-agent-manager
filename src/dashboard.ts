import type { Snapshot } from "./model.ts";

function data(id: string, value: unknown): string {
  // Escaping < keeps issue text from closing the data block.
  return `<script type="application/json" id="${id}">${JSON.stringify(value).replace(/</g, "\\u003c")}</script>`;
}

/** A dashboard for the given repos, read live from GitHub. Nothing else can be opened from it. */
export function siteHtml(template: string, repos: string[]): string {
  return template.replace("<!--gam:config-->", () => data("config", { repos }));
}

/** A page with a plan baked in, which works from disk with no network or token. */
export function dashboardHtml(template: string, snapshot: Snapshot, at: Date): string {
  return siteHtml(template, [`${snapshot.owner}/${snapshot.repo}`]).replace("<!--gam:snapshot-->", () => data("snapshot", { snapshot, at: at.toISOString() }));
}
