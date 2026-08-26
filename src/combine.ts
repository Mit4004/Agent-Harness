import { execSync } from "node:child_process";
import type { BumpPlan, VerifyTier } from "./types.js";
import { runTier } from "./baseline.js";

/**
 * Cherry-picks every green bump onto one combined branch and re-runs the
 * tier command once more. Individually-green bumps can still conflict
 * with each other (shared transitive deps, lockfile churn) — this is the
 * step that catches that before anything reaches a PR.
 */
export function combineGreens(
  repoDir: string,
  plan: BumpPlan,
  tier: VerifyTier,
): { passed: boolean; output: string; combinedBranch: string } {
  const combinedBranch = `fix/deps-${plan.runId}`;
  const greens = plan.bumps.filter((b) => b.result === "green");

  execSync(`git checkout -b ${combinedBranch} ${plan.baseBranch}`, { cwd: repoDir, stdio: "pipe" });

  for (const bump of greens) {
    execSync(`git cherry-pick ${bump.branch}`, { cwd: repoDir, stdio: "pipe" });
  }

  const result = runTier(repoDir, tier);
  return { passed: result.passed, output: result.output, combinedBranch };
}
