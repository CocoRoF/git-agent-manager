import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { it } from "node:test";
import { dashboardHtml, siteHtml } from "../src/dashboard.ts";
import { FakeTracker } from "./fake.ts";

it("embeds issue text so it can't close the data block", async () => {
  const t = new FakeTracker();
  await t.createMilestone({ title: "M" });
  t.seed({ title: "</script><script>alert(1)</script>", milestone: 1 });
  const html = dashboardHtml("<body><!--gam:config--><!--gam:snapshot--></body>", await t.snapshot(), new Date(0));
  assert.equal(html.match(/<script/g)!.length, 2);
  assert.equal(html.match(/<\/script>/g)!.length, 2);
  const data = /<script[^>]*id="snapshot">(.*?)<\/script>/s.exec(html)![1]!;
  assert.equal(JSON.parse(data).snapshot.issues[0].title, "</script><script>alert(1)</script>");
});

it("keeps $ patterns in issue text intact", async () => {
  const t = new FakeTracker();
  await t.createMilestone({ title: "M" });
  t.seed({ title: "costs $& and $'", milestone: 1 });
  assert.match(dashboardHtml("<!--gam:snapshot-->", await t.snapshot(), new Date(0)), /costs \$& and \$'/);
});

it("never builds the page from strings", () => {
  for (const file of readdirSync("src/viewer").filter((f) => f.endsWith(".ts"))) {
    const code = readFileSync(`src/viewer/${file}`, "utf8");
    assert.doesNotMatch(code, /\.(innerHTML|outerHTML)\b|insertAdjacentHTML|document\.write|\beval\(/, file);
  }
});

it("bakes the repos into the page, so it opens nothing else", () => {
  const html = siteHtml("<!--gam:config--><!--gam:snapshot-->", ["o/r", "o/s"]);
  assert.match(html, /<script type="application\/json" id="config">\{"repos":\["o\/r","o\/s"\]\}<\/script>/);
  assert.match(html, /<!--gam:snapshot-->/);
});
