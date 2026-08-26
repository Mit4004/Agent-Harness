import { execSync } from "node:child_process";
import type { BumpPlan, VerifyTier } from "./types.js";
import { runTier } from "./baseline.js";

/**
 * Applies every green bump's target version together on one fresh branch
 * off base, in a single `npm install`, and re-runs the tier command once
 * more. Individually-green bumps can still conflict with each other
 * (shared transitive deps) — this is the step that catches that before
 * anything reaches a PR.
 *
 * Deliberately does NOT cherry-pick each bump's individual commit: two
 * bumps verified in isolation each regenerate package-lock.json from the
 * same base, and git cherry-picking both onto one branch reliably produces
 * a real merge conflict in the lockfile (confirmed empirically, not a
 * hypothetical) even when the actual dependency versions don't conflict
 * at all. Letting npm compute one coherent lockfile for the combination
 * in a single pass sidesteps that entirely.
 */
export function combineGreens(
  repoDir: string,
  plan: BumpPlan,
  tier: VerifyTier,
): { passed: boolean; output: string; combinedBranch: string } {
  const combinedBranch = `fix/deps-${plan.runId}`;
  const greens = plan.bumps.filter((b) => b.result === "green");

  execSync(`git checkout ${plan.baseBranch}`, { cwd: repoDir, stdio: "pipe" });
  execSync(`git checkout -B ${combinedBranch}`, { cwd: repoDir, stdio: "pipe" });
  execSync(`npm ci`, { cwd: repoDir, stdio: "pipe" });

  if (greens.length > 0) {
    const targets = greens.map((b) => `${b.package}@${b.target}`).join(" ");
    execSync(`npm install ${targets}`, { cwd: repoDir, stdio: "pipe" });
  }

  const result = runTier(repoDir, tier);

  if (result.passed) {
    execSync(`git add -A`, { cwd: repoDir, stdio: "pipe" });
    execSync(`git commit -m "Combine ${greens.length} verified dependency bump(s)"`, { cwd: repoDir, stdio: "pipe" });
  }

  return { passed: result.passed, output: result.output, combinedBranch };
}
