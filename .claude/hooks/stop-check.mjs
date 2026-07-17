// Stop hook: 応答終了前に全チェックを実行し、失敗があれば exit 2 で継続を促す。
// stdin: {"stop_hook_active": bool, ...} 形式のJSON。無限ループ防止のため stop_hook_active 時は即終了。
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// フックはセッションの現在ディレクトリで実行されるため、
// スクリプト自身の位置からプロジェクトルートを特定して移動する
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."));

try {
  const j = JSON.parse(readFileSync(0, "utf8"));
  if (j.stop_hook_active) process.exit(0);
} catch {
  // stdinが読めなくてもチェック自体は実行する
}

function run(label, cmd, cwd, tailLines) {
  const r = spawnSync(cmd, { shell: true, cwd, encoding: "utf8", timeout: 300000 });
  const out = ((r.stdout ?? "") + (r.stderr ?? ""))
    .split("\n")
    .slice(-tailLines)
    .join("\n");
  return { label, status: r.status ?? 1, out };
}

const results = [];
if (existsSync("backend/Cargo.toml")) {
  results.push(run("cargo test", "cargo test --quiet", "backend", 20));
  results.push(run("cargo clippy", "cargo clippy --quiet -- -D warnings", "backend", 10));
}
if (existsSync("frontend/src")) {
  results.push(run("vitest", "npx vitest run --passWithNoTests", "frontend", 20));
  // viteテンプレートはproject references構成のため -b で全プロジェクトを検査する
  results.push(run("tsc (frontend)", "npx tsc -b --pretty false", "frontend", 10));
}
if (existsSync("infra/lib")) {
  results.push(run("tsc (infra)", "npx tsc --noEmit --pretty false", "infra", 10));
}

const failed = results.filter((r) => r.status !== 0);
if (failed.length > 0) {
  for (const f of failed) {
    console.error(`--- FAILED: ${f.label} ---`);
    console.error(f.out);
  }
  process.exit(2);
}
process.exit(0);
