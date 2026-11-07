import type { Snapshot } from "./model.ts";

/** Fills the viewer template with a plan, for a page that works from disk with no network or token. */
export function dashboardHtml(template: string, snapshot: Snapshot, at: Date): string {
  // Escaping < keeps issue text from closing the data block.
  const json = JSON.stringify({ snapshot, at: at.toISOString() }).replace(/</g, "\\u003c");
  return template.replace("<!--gam:snapshot-->", () => `<script type="application/json" id="snapshot">${json}</script>`);
}
