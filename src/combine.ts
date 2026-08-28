import { execFileSync } from "node:child_process";
import type { BumpPlan, VerifyTier } from "./types.js";
import { runTier } from "./baseline.js";

function run(repoDir: string, command: string, args: string[]): void {
  execFileSync(command, args, { cwd: repoDir, stdio: "pipe" });
}

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

  run(repoDir, "git", ["checkout", plan.baseBranch]);
  run(repoDir, "git", ["checkout", "-B", combinedBranch]);
  run(repoDir, "npm", ["ci"]);

  if (greens.length > 0) {
    const targets = greens.map((b) => `${b.package}@${b.target}`);
    run(repoDir, "npm", ["install", ...targets]);
  }

  const result = runTier(repoDir, tier);

  // With zero green bumps there's nothing to commit — the combined branch
  // is identical to base, and `git commit` on no staged changes exits
  // nonzero and throws. Zero-included is a valid, expected outcome (a bad
  // run where every bump failed), not an error; only commit when there's
  // an actual manifest diff to record.
  if (result.passed && greens.length > 0) {
    run(repoDir, "git", ["add", "package.json", "package-lock.json"]);
    run(repoDir, "git", ["commit", "-m", `Combine ${greens.length} verified dependency bump(s)`]);
  }

  return { passed: result.passed, output: result.output, combinedBranch };
}
