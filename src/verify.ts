import { execFileSync } from "node:child_process";
import { runNpm } from "./npm.js";
import type { Bump, VerifyTier } from "./types.js";
import { runTier } from "./baseline.js";

/**
 * Runs one git or npm command in the target repo, always as an argument
 * array and never through a shell. npm is dispatched via runNpm because
 * plain execFileSync("npm", ...) does not resolve on Windows -- see npm.ts.
 */
function run(repoDir: string, command: string, args: string[]): void {
  if (command === "npm") {
    runNpm(args, { cwd: repoDir });
    return;
  }
  execFileSync(command, args, { cwd: repoDir, stdio: "pipe" });
}

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

/** Numeric-only semver comparison (no prerelease/build metadata handling — sufficient for the plain X.Y.Z versions audit/registry data gives us here). */
export function isVersionGreater(a: string, b: string): boolean {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/** Only the dependency manifest files belong in a bump commit — never
 * `git add -A`, which would sweep in anything the test/build run happened
 * to generate, modify, or delete in the target repo. */
function commitManifestChanges(repoDir: string, message: string): void {
  run(repoDir, "git", ["add", "package.json", "package-lock.json"]);
  run(repoDir, "git", ["commit", "-m", message]);
}

/**
 * Verifies one bump on its own branch: install the target version, run
 * the tier command, and compare failures against the baseline so a
 * pre-existing red test is never blamed on this bump.
 *
 * Always branches from `baseBranch` explicitly (never "whatever HEAD
 * happens to be") — required for correctness once a single package can be
 * verified more than once in the same run, as the opportunistic-upgrade
 * fallback below does.
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
  baseBranch: string,
): Bump {
  run(repoDir, "git", ["checkout", baseBranch]);
  run(repoDir, "git", ["checkout", "-B", bump.branch]);
  // node_modules is untracked and shared across every branch in repoDir —
  // without a clean reinstall here, a previous bump's install leaks into
  // this one (verified the hard way: a bump appeared to pass only because
  // an earlier bump's install of a different package was still present).
  run(repoDir, "npm", ["ci"]);
  run(repoDir, "npm", ["install", `${bump.package}@${bump.target}`]);

  const result = runTier(repoDir, tier);
  const attempts = bump.attempts + 1;
  const verified = classifyResult({ bump, result, tier, baselineFailures, attempts, diagnose });

  // Only a green bump is worth a commit, and only the manifest files are
  // part of it — never whatever the test/build run happened to generate
  // or touch along the way. A failed attempt's changes are discarded here
  // so the working tree is clean before the next bump's checkout; without
  // this, package.json/package-lock.json edits from a failed attempt
  // would otherwise be silently carried onto whatever branch comes next.
  if (verified.result === "green") {
    commitManifestChanges(repoDir, `Bump ${bump.package} to ${bump.target}`);
  } else {
    run(repoDir, "git", ["checkout", "--", "."]);
    run(repoDir, "git", ["clean", "-fd"]);
  }

  return verified;
}

function classifyResult(args: {
  bump: Bump;
  result: { passed: boolean; failures: string[]; output: string };
  tier: VerifyTier;
  baselineFailures: string[];
  attempts: number;
  diagnose: DiagnoseFn;
}): Bump {
  const { bump, result, tier, baselineFailures, attempts, diagnose } = args;

  if (tier !== "tests") {
    return {
      ...bump,
      verifyTier: tier,
      attempts,
      result: result.passed ? "green" : "failed",
      failureExcerpt: result.passed ? null : truncate(result.output),
    };
  }

  if (result.passed) {
    return { ...bump, verifyTier: tier, attempts, result: "green", failureExcerpt: null };
  }

  // The run failed overall. Only call it green if we can specifically
  // attribute every failure to the pre-existing baseline — never treat
  // "couldn't identify which tests failed" as "must be fine, then". Name
  // extraction is best-effort and varies by test runner (TAP, Jest, ...),
  // so an empty `result.failures` here means "unknown", not "none new".
  const introduced = newTestFailures(baselineFailures, result.failures);
  const allFailuresArePreexisting = result.failures.length > 0 && introduced.length === 0;
  if (allFailuresArePreexisting) {
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

/**
 * Verifies a bump, opportunistically trying the package's latest version
 * before settling for the audit's minimal safe fix. If latest verifies
 * green, we take it — free extra currency on top of the required fix. If
 * it fails, we fall back to the safe target and report why the attempt at
 * latest didn't pan out, rather than silently only ever offering the
 * minimum.
 *
 * No-ops straight to `verifyBump` when there's no higher version to try,
 * so callers can use this unconditionally without checking themselves.
 */
export function verifyBumpWithOpportunisticUpgrade(
  repoDir: string,
  bump: Bump,
  baselineFailures: string[],
  tier: VerifyTier,
  diagnose: DiagnoseFn,
  baseBranch: string,
  latestVersion: string | null,
): Bump {
  // "Opportunistic" only makes sense as an upgrade beyond the audit's
  // required fix — a "latest" dist-tag that happens to be at or below
  // `target` must never be substituted in, even if it verifies green,
  // or a still-vulnerable version could silently replace the safe one.
  if (!latestVersion || !isVersionGreater(latestVersion, bump.target)) {
    return verifyBump(repoDir, bump, baselineFailures, tier, diagnose, baseBranch);
  }

  const opportunisticBump: Bump = { ...bump, target: latestVersion, branch: `${bump.branch}-latest` };
  const opportunisticAttempt = verifyBump(repoDir, opportunisticBump, baselineFailures, tier, diagnose, baseBranch);

  if (opportunisticAttempt.result === "green") {
    // Keep the branch name pointing at where the commit actually landed
    // (`${bump.branch}-latest`) — overwriting it back to `bump.branch`
    // would point callers at a branch that was never created here.
    return {
      ...opportunisticAttempt,
      latestVersion,
      usedOpportunisticFallback: false,
    };
  }

  // Carry the failed attempt's count forward so the final result reflects
  // both tries, not just the fallback's own single attempt.
  const fallbackAttempt = verifyBump(
    repoDir,
    { ...bump, attempts: opportunisticAttempt.attempts },
    baselineFailures,
    tier,
    diagnose,
    baseBranch,
  );
  const fellBack = fallbackAttempt.result === "green";

  return {
    ...fallbackAttempt,
    latestVersion,
    usedOpportunisticFallback: fellBack,
    diagnosis: fellBack
      ? `Tried the latest version (${latestVersion}) first: ${opportunisticAttempt.diagnosis ?? "it failed verification"}. Fell back to the audit-recommended ${bump.target}, which verified clean.`
      : fallbackAttempt.diagnosis,
  };
}
