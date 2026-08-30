import { execFileSync } from "node:child_process";
import type { Finding, ScanReport } from "./types.js";
import { scrubSecrets } from "./secrets.js";

interface SemgrepFinding {
  check_id?: string;
  path?: string;
  start?: { line?: number };
  extra?: {
    message?: string;
    severity?: string;
    lines?: string;
  };
}

interface SemgrepOutput {
  results?: SemgrepFinding[];
  errors?: unknown[];
}

/** semgrep's ERROR/WARNING/INFO onto the severity vocabulary already in use. */
function mapSeverity(raw: string | undefined): Finding["severity"] {
  switch ((raw || "").toUpperCase()) {
    case "ERROR":
      return "High";
    case "WARNING":
      return "Medium";
    default:
      return "Low";
  }
}

export function parseSemgrep(json: unknown): Finding[] {
  const parsed = json as SemgrepOutput;
  return (parsed.results ?? []).map((result, index) => ({
    id: `SAST-${String(index + 1).padStart(2, "0")}`,
    kind: "sast" as const,
    rule: result.check_id ?? "unknown-rule",
    severity: mapSeverity(result.extra?.severity),
    file: result.path ?? "unknown",
    line: result.start?.line ?? 0,
    // Both fields are scrubbed, not merely trimmed. A matched source line is
    // raw code, and a rule message can interpolate the matched value — so a
    // static-analysis finding on a hardcoded credential would otherwise
    // republish that credential in the very report meant to warn about it.
    message: scrubSecrets(result.extra?.message?.trim() ?? "No message provided by the rule."),
    excerpt: scrubSecrets((result.extra?.lines ?? "").trim().slice(0, 200)),
  }));
}

/**
 * Runs semgrep over the repo and returns its findings.
 *
 * Exit codes are read strictly. Without `--error`, semgrep exits 0 whether or
 * not it finds anything, so a non-zero exit means the scan itself failed
 * rather than that it found something. Treating that stdout as a successful
 * result — the way a non-zero `npm audit` legitimately can be — would let a
 * failed or partial scan render as "no findings", which is the one thing this
 * report must never do. `errors` in the payload is treated the same way.
 */
export function runSast(repoDir: string): ScanReport {
  let stdout: string;
  try {
    stdout = execFileSync(
      "semgrep",
      ["--config", "auto", "--json", "--quiet", "--timeout", "120", "."],
      {
        cwd: repoDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } catch (error) {
    const err = error as { code?: string; message?: string };
    return {
      status: "unavailable",
      reason:
        err.code === "ENOENT"
          ? "semgrep is not installed in this environment, so no static analysis was performed."
          : `semgrep exited non-zero, which without --error means the scan failed rather than found something: ${(err.message || "").split("\n")[0]}`,
      findings: [],
      skipped: [],
    };
  }

  let parsed: SemgrepOutput;
  try {
    parsed = JSON.parse(stdout) as SemgrepOutput;
  } catch {
    return {
      status: "unavailable",
      reason: "semgrep produced output that could not be parsed as JSON.",
      findings: [],
      skipped: [],
    };
  }

  const findings = parseSemgrep(parsed);
  const errorCount = Array.isArray(parsed.errors) ? parsed.errors.length : 0;
  if (errorCount > 0) {
    // It produced results, but not over the whole tree — say so rather than
    // presenting a partial scan as a complete one.
    return {
      status: "partial",
      reason: `semgrep reported ${errorCount} error(s) during the scan, so some files may not have been analysed.`,
      findings,
      skipped: [],
    };
  }

  return { status: "ran", reason: null, findings, skipped: [] };
}
