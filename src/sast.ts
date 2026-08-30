import { execFileSync } from "node:child_process";
import type { Finding, ScanReport } from "./types.js";

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
    message: result.extra?.message?.trim() ?? "No message provided by the rule.",
    // Trimmed and length-capped: a matched line can be long, and the raw
    // source of a security finding is exactly the kind of thing that should
    // not balloon a PR body or the model's context.
    excerpt: (result.extra?.lines ?? "").trim().slice(0, 200),
  }));
}

/**
 * Runs semgrep over the repo and returns its findings.
 *
 * Reports `unavailable` rather than an empty result when semgrep isn't
 * installed. That distinction matters more than it looks: "we scanned and
 * found nothing" and "we could not scan" are completely different claims to a
 * reader, and collapsing them into an empty list is how a tool ends up
 * implying safety it never established.
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
    const err = error as { code?: string; stdout?: string | Buffer };
    // semgrep exits non-zero when it finds something; that is a successful run.
    const captured = err.stdout ? err.stdout.toString() : "";
    if (captured.trim()) {
      stdout = captured;
    } else {
      return {
        status: "unavailable",
        reason:
          err.code === "ENOENT"
            ? "semgrep is not installed in this environment, so no static analysis was performed."
            : `semgrep could not be run: ${(error as Error).message.split("\n")[0]}`,
        findings: [],
      };
    }
  }

  try {
    return { status: "ran", reason: null, findings: parseSemgrep(JSON.parse(stdout)) };
  } catch {
    return {
      status: "unavailable",
      reason: "semgrep produced output that could not be parsed as JSON.",
      findings: [],
    };
  }
}
