import type { Bump, BumpPlan } from "./types.js";

const TIER_LABEL: Record<Bump["verifyTier"], string> = {
  tests: "verified: tests pass",
  build: "build-verified only — no test evidence",
  resolves: "unverified — install resolves cleanly only",
  none: "not verified",
};

function renderBumpLine(bump: Bump): string {
  const label = TIER_LABEL[bump.verifyTier];
  const line = `- **${bump.package}** \`${bump.current}\` → \`${bump.target}\` (${bump.severity}, ${bump.advisory}) — _${label}_`;
  if (bump.usedOpportunisticFallback && bump.latestVersion) {
    return `${line}\n  (tried latest \`${bump.latestVersion}\` first — it failed verification, fell back to this audit-recommended version)`;
  }
  if (bump.latestVersion && bump.target === bump.latestVersion) {
    return `${line}\n  (this is also the latest published version — verified clean, not just the minimal fix)`;
  }
  return line;
}

function renderFailedLine(bump: Bump): string {
  const reason = bump.diagnosis ?? "Introduced new test failures.";
  const rec = bump.recommendation ? ` Recommendation: ${bump.recommendation}` : "";
  return `- **${bump.package}** \`${bump.current}\` → \`${bump.target}\`: ${reason}${rec}`;
}

/**
 * Renders the PR body from a finished BumpPlan. One bump = one line in
 * exactly one bucket — this is also what Checkpoint B's Generative UI
 * table is built from, so the buckets here must match the buckets shown
 * to the user before they approve.
 */
export function renderPrBody(plan: BumpPlan): string {
  const green = plan.bumps.filter((b) => b.result === "green");
  const failed = plan.bumps.filter((b) => b.result === "failed");
  const skipped = plan.bumps.filter((b) => b.result === "skipped");

  const sections: string[] = [
    `## Dependency upgrades — verified per bump`,
    ``,
    `Baseline: ${plan.baseline.tier} tier, ${plan.baseline.failingTests.length} pre-existing failing test(s).`,
    ``,
    `### Included (${green.length})`,
    ...(green.length ? green.map(renderBumpLine) : ["_None verified green._"]),
    ``,
    `### Excluded — broke verification (${failed.length})`,
    ...(failed.length ? failed.map(renderFailedLine) : ["_None._"]),
  ];

  if (skipped.length) {
    sections.push(
      ``,
      `### Skipped by request (${skipped.length})`,
      ...skipped.map((b) => `- **${b.package}** \`${b.current}\` → \`${b.target}\``),
    );
  }

  return sections.join("\n");
}
