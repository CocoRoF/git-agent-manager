import { readFileSync, rmSync } from "node:fs";
import { build } from "esbuild";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
rmSync("dist", { recursive: true, force: true });

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  minify: true,
  platform: "node",
  target: "node20",
  format: "esm",
  define: { __VERSION__: JSON.stringify(version) },
  banner: { js: "#!/usr/bin/env node\nimport{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" },
  legalComments: "linked",
});
