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
