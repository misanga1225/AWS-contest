// PreToolUse hook (Bash): 破壊的コマンドをブロックする。
// stdin: {"tool_input": {"command": "..."}} 形式のJSON。
import { readFileSync } from "node:fs";

let cmd = "";
try {
  const j = JSON.parse(readFileSync(0, "utf8"));
  cmd = j.tool_input?.command ?? "";
} catch {
  process.exit(0);
}

const destructive =
  /rm\s+-rf|cdk\s+destroy|delete-table|aws\s+s3\s+rb|force-delete/i;

if (destructive.test(cmd)) {
  console.error("BLOCKED: destructive command detected");
  process.exit(2);
}
process.exit(0);
