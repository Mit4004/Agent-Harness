// Shared shape used by every stage of the pipeline: audit parsing, the
// approval UI, the verify loop, and the PR body renderer. No re-parsing
// of a different shape between stages.

export type BumpKind = "patch" | "minor" | "major";

export type VerifyTier = "tests" | "build" | "resolves" | "none";

export type BumpResult = "pending" | "green" | "failed" | "skipped";

export interface Bump {
  id: string;
  package: string;
  current: string;
  target: string;
  advisory: string;
  severity: "Critical" | "High" | "Medium" | "Low";
  bumpKind: BumpKind;
  strategyNote: string;
  branch: string;
  verifyTier: VerifyTier;
  baselineFailures: number;
  result: BumpResult;
  failureExcerpt: string | null;
  diagnosis: string | null;
  recommendation: string | null;
  attempts: number;
  /** The package's latest published version, when higher than `target`. */
  latestVersion: string | null;
  /** True when latestVersion was attempted first, failed verification, and target was used instead. */
  usedOpportunisticFallback: boolean;
}

export interface Baseline {
  tier: VerifyTier;
  failingTests: string[];
  durationMs: number;
}

export interface BumpPlan {
  repo: string;
  baseBranch: string;
  runId: string;
  baseline: Baseline;
  bumps: Bump[];
}

export interface TierRunResult {
  passed: boolean;
  /** Test names (or equivalent identifiers) that failed on this run. */
  failures: string[];
  /** Raw stdout+stderr, kept out of the model's context except on failure. */
  output: string;
}

// ---------------------------------------------------------------------------
// Findings: things we detect but deliberately do NOT fix.
//
// A Bump is something the agent changed *and proved* against the repo's own
// tests. A Finding is the opposite: reported, never auto-remediated. They are
// separate types on purpose, so nothing unverified can ever be presented with
// the authority of a verified bump.
//
// Why report-only: a dependency upgrade has an honest oracle — the test suite
// either still passes or it doesn't. A code-level SAST fix does not; the tests
// rarely cover the patched path, so "we fixed it" would be a claim with no
// evidence behind it. Secrets are stronger still: the only real remediation is
// rotating the credential at its source, which no agent should do on your
// behalf. So both are surfaced for a human and left alone.
// ---------------------------------------------------------------------------

export type FindingKind = "sast" | "secret";

/** Whether a scanner actually ran, so "no findings" is never ambiguous. */
export type ScanStatus = "ran" | "unavailable" | "skipped";

export interface Finding {
  id: string;
  kind: FindingKind;
  /** Short rule identifier, e.g. "aws-access-key-id" or a semgrep check id. */
  rule: string;
  severity: "Critical" | "High" | "Medium" | "Low";
  file: string;
  line: number;
  /** Human-readable description of what was matched and why it matters. */
  message: string;
  /**
   * Redacted evidence. For secrets this is deliberately masked — the raw match
   * must never reach a PR body, a log, or the model's context, since that would
   * republish the very credential being reported.
   */
  excerpt: string;
}

export interface ScanReport {
  /** Why a scanner produced no findings: it ran, or it could not run at all. */
  status: ScanStatus;
  /** Present when status is not "ran" — e.g. the scanner is not installed. */
  reason: string | null;
  findings: Finding[];
}

export interface SecurityScan {
  secrets: ScanReport;
  sast: ScanReport;
}
