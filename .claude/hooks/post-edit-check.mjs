// PostToolUse hook: 編集されたファイルに応じて型チェック/コンパイルチェックを走らせる。
// stdin: {"tool_input": {"file_path": "..."}} 形式のJSON。
// 失敗時は stderr に出力して exit 2（Claudeにフィードバックされる）。
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

let file = "";
try {
  const j = JSON.parse(readFileSync(0, "utf8"));
  file = j.tool_input?.file_path ?? j.tool_input?.path ?? "";
} catch {
  process.exit(0);
}
if (!file) process.exit(0);

const p = file.replace(/\\/g, "/");

function run(cmd, cwd, headLines) {
  const r = spawnSync(cmd, { shell: true, cwd, encoding: "utf8", timeout: 120000 });
  const out = ((r.stdout ?? "") + (r.stderr ?? ""))
    .split("\n")
    .slice(0, headLines)
    .join("\n");
  return { status: r.status ?? 1, out };
}

let res = null;
if (p.endsWith(".rs") && existsSync("backend/Cargo.toml")) {
  res = run("cargo check --message-format=short", "backend", 15);
} else if (/frontend\/.+\.(ts|tsx)$/.test(p) && existsSync("frontend/package.json")) {
  res = run("npx tsc --noEmit --pretty false", "frontend", 15);
} else if (/infra\/.+\.ts$/.test(p) && existsSync("infra/package.json")) {
  res = run("npx tsc --noEmit --pretty false", "infra", 15);
}

if (res && res.status !== 0) {
  console.error(res.out);
  process.exit(2);
}
process.exit(0);
