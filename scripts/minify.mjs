import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { transform } from "esbuild";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const ignoredDirs = new Set(["node_modules", ".git", "dist", "scripts", "mock"]);
const ignoredFiles = new Set(["package-lock.json", "package.json"]);

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        files.push(...await collectFiles(filePath));
      }
      continue;
    }

    if (!entry.isFile() || ignoredFiles.has(entry.name) || entry.name.endsWith(".ts")) {
      continue;
    }

    files.push(filePath);
  }

  return files;
}

async function writeMinifiedJavaScript(sourcePath, outputPath) {
  const source = await readFile(sourcePath, "utf8");
  const result = await transform(source, {
    format: "iife",
    legalComments: "none",
    loader: "js",
    minify: true,
    sourcemap: false,
    target: "es2021"
  });

  await writeFile(outputPath, result.code, "utf8");
}

await rm(distDir, { recursive: true, force: true });

const files = await collectFiles(rootDir);
for (const filePath of files) {
  const relativePath = path.relative(rootDir, filePath);
  const outputPath = path.join(distDir, relativePath);
  await mkdir(path.dirname(outputPath), { recursive: true });

  if (filePath.endsWith(".js")) {
    await writeMinifiedJavaScript(filePath, outputPath);
    continue;
  }

  await copyFile(filePath, outputPath);
}

console.log(`Created minified extension package: ${path.relative(rootDir, distDir)}`);
