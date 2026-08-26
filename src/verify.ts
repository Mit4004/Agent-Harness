import { execSync } from "node:child_process";
import type { Bump, VerifyTier } from "./types.js";
import { runTier } from "./baseline.js";

export interface DiagnoseFn {
  (args: { bump: Bump; output: string }): { diagnosis: string; recommendation: string };
}

function newTestFailures(baseline: string[], current: string[]): string[] {
  const base = new Set(baseline);
  return current.filter((name) => !base.has(name));
}

function truncate(output: string, maxChars = 4000): string {
  return output.length > maxChars ? output.slice(-maxChars) : output;
}

/**
 * Verifies one bump on its own branch: install the target version, run
 * the tier command, and compare failures against the baseline so a
 * pre-existing red test is never blamed on this bump.
 *
 * `diagnose` is injected (rather than called directly) so this module
 * stays a pure, testable state machine — the model call is the caller's
 * concern, this function only decides green/failed and asks for a
 * diagnosis when it needs one.
 */
export function verifyBump(
  repoDir: string,
  bump: Bump,
  baselineFailures: string[],
  tier: VerifyTier,
  diagnose: DiagnoseFn,
): Bump {
  execSync(`git checkout -b ${bump.branch}`, { cwd: repoDir, stdio: "pipe" });
  execSync(`npm install ${bump.package}@${bump.target}`, { cwd: repoDir, stdio: "pipe" });

  const result = runTier(repoDir, tier);
  const attempts = bump.attempts + 1;

  if (tier !== "tests") {
    return {
      ...bump,
      verifyTier: tier,
      attempts,
      result: result.passed ? "green" : "failed",
      failureExcerpt: result.passed ? null : truncate(result.output),
    };
  }

  const introduced = newTestFailures(baselineFailures, result.failures);
  if (introduced.length === 0) {
    return { ...bump, verifyTier: tier, attempts, result: "green", failureExcerpt: null };
  }

  const { diagnosis, recommendation } = diagnose({ bump, output: result.output });
  return {
    ...bump,
    verifyTier: tier,
    attempts,
    result: "failed",
    failureExcerpt: truncate(result.output),
    diagnosis,
    recommendation,
  };
}
