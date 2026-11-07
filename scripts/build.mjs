import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/viewer", { recursive: true });

const viewer = await build({
  entryPoints: ["src/viewer/main.ts"],
  bundle: true,
  minify: true,
  write: false,
  format: "iife",
  target: "es2020",
  legalComments: "none",
});
const js = viewer.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = (await build({ entryPoints: ["src/viewer/style.css"], minify: true, write: false, loader: { ".css": "css" } })).outputFiles[0].text;
const sha = (s) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;

// Nothing but this one script and style can run, and the page can only talk to GitHub's API.
const csp = `default-src 'none'; script-src ${sha(js)}; style-src ${sha(css)}; style-src-attr 'unsafe-inline'; connect-src https://api.github.com; img-src data:; base-uri 'none'; form-action 'none'`;
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<title>Plan dashboard</title>
<style>${css}</style>
</head>
<body>
<main id="app"></main>
<!--gam:snapshot-->
<script>${js}</script>
</body>
</html>
`;
writeFileSync("dist/viewer/index.html", html);

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  minify: true,
  platform: "node",
  target: "node20",
  format: "esm",
  define: { __VERSION__: JSON.stringify(version), __VIEWER_HTML__: JSON.stringify(html) },
  banner: { js: "#!/usr/bin/env node\nimport{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" },
  legalComments: "none",
});
chmodSync("dist/cli.js", 0o755);
