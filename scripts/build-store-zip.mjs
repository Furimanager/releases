// 拡張機能の配布パッケージを2種類つくる。
// 許可リスト方式でファイルを集めるため、mock/ や *.ts、開発用設定は出力に含まれない。
// zip 化はこのスクリプトでは行わず、最後に Windows 用のコマンドを表示する。
//
// なぜ2種類あるのか（重要）:
//   store    … manifest の "key" を除く。ストアは自前の鍵でIDを割り当てるため。
//   selfhost … "key" を残す。これが無いと拡張機能IDが展開先フォルダのパスから
//              作られてしまい、人ごと・PCごとに変わる。IDが変わると
//              NEXT_PUBLIC_EXTENSION_IDS の許可リストに載らず、
//              /extension/connect からのトークン連携が通らなくなる。
import { access, copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const VARIANTS = [
  {
    name: "store",
    outDir: path.join(distDir, "store"),
    zipRelativePath: "dist/furimanager-extension-store.zip",
    keepKey: false,
    description: "Chrome ウェブストア提出用"
  },
  {
    name: "selfhost",
    outDir: path.join(distDir, "selfhost"),
    zipRelativePath: "dist/furimanager-extension.zip",
    keepKey: true,
    description: "GitHub リリース配布用（拡張機能IDを固定）"
  }
];

// ルート直下でコピーするファイル（manifest.json は変換して別途書き出す）。
const ALLOWED_ROOT_FILES = [
  "background.js",
  "config.js",
  "content.js",
  "parser.js",
  "content-script.js",
  "content-script-relist.js",
  "popup.html",
  "popup.js",
  "popup.css"
];

// コピーするディレクトリ。extensions が null の場合は全ファイルを対象にする。
const ALLOWED_DIRECTORIES = [
  { dir: "icons", extensions: null },
  { dir: "src", extensions: [".js", ".css"] }
];

function logInfo(message) {
  console.log(`[build:store] ${message}`);
}

function failWith(message) {
  console.error(`[build:store] ${message}`);
  process.exit(1);
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

async function copyAllowedDirectory(outDir, dirName, extensions) {
  const sourceDir = path.join(rootDir, dirName);

  if (!(await pathExists(sourceDir))) {
    failWith(`${dirName}/ が見つかりません。リポジトリの状態を確認してください。`);
  }

  const copied = [];
  const stack = [sourceDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();

      // .ts は必ず除外する（ビルド生成物の .js だけを配布する）。
      if (extension === ".ts") {
        continue;
      }

      if (extensions && !extensions.includes(extension)) {
        continue;
      }

      const relativePath = path.relative(rootDir, entryPath);
      const outputPath = path.join(outDir, relativePath);

      await mkdir(path.dirname(outputPath), { recursive: true });
      await copyFile(entryPath, outputPath);
      copied.push(toPosix(relativePath));
    }
  }

  return copied;
}

async function writeVariantManifest(outDir, keepKey) {
  const manifestPath = path.join(rootDir, "manifest.json");

  if (!(await pathExists(manifestPath))) {
    failWith("manifest.json が見つかりません。");
  }

  const rawManifest = await readFile(manifestPath, "utf8");
  let manifest;

  try {
    manifest = JSON.parse(rawManifest);
  } catch (error) {
    failWith(`manifest.json を JSON として読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`);
  }

  // "key" は拡張機能IDを固定するための項目。ストア提出版だけ取り除く。
  const hadKey = Object.prototype.hasOwnProperty.call(manifest, "key");

  if (!keepKey) {
    delete manifest.key;
  }

  await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  if (hadKey && !keepKey) {
    logInfo('manifest.json の "key" を除去しました（ソース側の manifest.json は変更していません）。');
  } else if (hadKey) {
    logInfo('manifest.json の "key" は残しました（拡張機能IDを固定するため）。');
  }

  return manifest;
}

function collectManifestReferences(manifest) {
  const references = new Set();

  const addReference = (value) => {
    if (typeof value !== "string" || value.length === 0) {
      return;
    }

    // ワイルドカードを含む指定は実ファイル検証の対象外にする。
    if (value.includes("*")) {
      return;
    }

    references.add(value.replace(/^\.\//, ""));
  };

  for (const contentScript of manifest.content_scripts ?? []) {
    for (const file of contentScript.js ?? []) {
      addReference(file);
    }
    for (const file of contentScript.css ?? []) {
      addReference(file);
    }
  }

  addReference(manifest.background?.service_worker);
  for (const file of manifest.background?.scripts ?? []) {
    addReference(file);
  }

  for (const entry of manifest.web_accessible_resources ?? []) {
    for (const resource of entry?.resources ?? []) {
      addReference(resource);
    }
  }

  for (const iconPath of Object.values(manifest.icons ?? {})) {
    addReference(iconPath);
  }

  for (const iconPath of Object.values(manifest.action?.default_icon ?? {})) {
    addReference(iconPath);
  }

  addReference(manifest.action?.default_popup);

  return [...references].sort();
}

async function verifyManifestReferences(outDir, manifest) {
  const references = collectManifestReferences(manifest);
  const missing = [];

  for (const reference of references) {
    if (!(await pathExists(path.join(outDir, reference)))) {
      missing.push(reference);
    }
  }

  if (missing.length > 0) {
    failWith(`manifest.json が参照するファイルが出力先にありません: ${missing.join(", ")}`);
  }

  logInfo(`manifest.json の参照 ${references.length} 件をすべて確認しました。`);
}

async function loadEsbuildTransform() {
  const packageJsonPath = path.join(rootDir, "package.json");

  if (!(await pathExists(packageJsonPath))) {
    logInfo("package.json が見つからないため minify をスキップします。");
    return null;
  }

  let packageJson;

  try {
    packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch {
    logInfo("package.json を読み込めなかったため minify をスキップします。");
    return null;
  }

  if (!packageJson.devDependencies?.esbuild) {
    logInfo("esbuild が devDependencies に無いため minify をスキップします。");
    return null;
  }

  try {
    const esbuild = await import("esbuild");
    return esbuild.transform;
  } catch {
    logInfo("esbuild を読み込めなかったため minify をスキップします（npm install を実行してください）。");
    return null;
  }
}

async function minifyJavaScriptFiles(outDir, transform, relativePaths) {
  let minifiedCount = 0;

  for (const relativePath of relativePaths) {
    if (!relativePath.endsWith(".js")) {
      continue;
    }

    const outputPath = path.join(outDir, relativePath.split("/").join(path.sep));
    const source = await readFile(outputPath, "utf8");

    let result;

    try {
      result = await transform(source, {
        minify: true,
        sourcemap: false,
        legalComments: "none"
      });
    } catch (error) {
      failWith(`${relativePath} の minify に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
    }

    await writeFile(outputPath, result.code, "utf8");
    minifiedCount += 1;
  }

  return minifiedCount;
}

async function buildVariant({ name, outDir, keepKey, description }) {
  console.log("");
  logInfo(`[${name}] ${description} を作成します。`);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const manifest = await writeVariantManifest(outDir, keepKey);
  const copiedFiles = [];

  for (const fileName of ALLOWED_ROOT_FILES) {
    const sourcePath = path.join(rootDir, fileName);

    if (!(await pathExists(sourcePath))) {
      failWith(`${fileName} が見つかりません。ビルド（npm run build）を実行してから再度お試しください。`);
    }

    await copyFile(sourcePath, path.join(outDir, fileName));
    copiedFiles.push(fileName);
  }

  for (const { dir, extensions } of ALLOWED_DIRECTORIES) {
    copiedFiles.push(...await copyAllowedDirectory(outDir, dir, extensions));
  }

  copiedFiles.sort();

  const transform = await loadEsbuildTransform();

  if (transform) {
    const minifiedCount = await minifyJavaScriptFiles(outDir, transform, copiedFiles);
    logInfo(`esbuild で ${minifiedCount} 件の .js を minify しました。`);
  } else {
    logInfo("minifyスキップ");
  }

  await verifyManifestReferences(outDir, manifest);

  logInfo(`manifest.json を含む ${copiedFiles.length + 1} 件を dist/${name}/ に出力しました。`);

  return copiedFiles;
}

async function main() {
  // config.js は本番値を含むため、テンプレートのままだと提出できない。
  if (!(await pathExists(path.join(rootDir, "config.js")))) {
    failWith("config.js がありません。config.template.js を config.js にコピーして本番値を設定してください。");
  }

  for (const variant of VARIANTS) {
    await buildVariant(variant);
  }

  console.log("");
  console.log("次のコマンドで zip を作成してください（PowerShell / 拡張ルートで実行）:");
  for (const { name, zipRelativePath, description } of VARIANTS) {
    console.log(`  # ${description}`);
    console.log(`  powershell Compress-Archive -Path dist/${name}/* -DestinationPath ${zipRelativePath} -Force`);
  }
}

await main();
