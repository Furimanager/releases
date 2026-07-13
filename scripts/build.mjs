import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { transform } from "esbuild";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirs = new Set(["node_modules", ".git", "dist"]);

async function collectTypeScriptFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        files.push(...await collectTypeScriptFiles(path.join(dir, entry.name)));
      }

      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(path.join(dir, entry.name));
    }
  }

  return files;
}

async function buildFile(filePath) {
  const source = await readFile(filePath, "utf8");
  const result = await transform(source, {
    format: "iife",
    legalComments: "none",
    loader: "ts",
    target: "es2021"
  });
  const outputPath = filePath.replace(/\.ts$/, ".js");

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, result.code, "utf8");

  return path.relative(rootDir, outputPath).replaceAll(path.sep, "/");
}

const files = await collectTypeScriptFiles(rootDir);
const outputs = [];

for (const file of files.sort()) {
  outputs.push(await buildFile(file));
}

console.log(`Built ${outputs.length} extension scripts:`);
for (const output of outputs) {
  console.log(`- ${output}`);
}
