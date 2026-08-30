import type { Bump, BumpPlan, Finding, ScanReport, SecurityScan } from "./types.js";

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

const SEVERITY_ORDER: Record<Finding["severity"], number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

function renderFindingLine(finding: Finding): string {
  const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
  const excerpt = finding.excerpt ? ` — \`${finding.excerpt}\`` : "";
  return `- **${finding.severity}** \`${finding.rule}\` at \`${location}\` — ${finding.message}${excerpt}`;
}

function renderScanSection(title: string, report: ScanReport, noneText: string): string[] {
  const lines: string[] = [];

  if (report.status === "unavailable" || report.status === "skipped") {
    // Never let "could not scan" read as "nothing found".
    return [`### ${title}`, ``, `_Not scanned — ${report.reason ?? "scanner unavailable."}_`];
  }

  const heading = report.findings.length
    ? `### ${title} (${report.findings.length})`
    : `### ${title}`;
  lines.push(heading, ``);

  if (report.status === "partial") {
    // Stated before the results, not after: a reader who stops at the first
    // line should still learn that the coverage was incomplete.
    lines.push(`> ⚠️ **Incomplete scan.** ${report.reason ?? ""}`.trim(), ``);
  }

  if (report.findings.length === 0) {
    lines.push(
      report.status === "partial"
        ? `_No findings in the files that were inspected — see the caveat above._`
        : `_${noneText}_`,
    );
  } else {
    const sorted = [...report.findings].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );
    lines.push(...sorted.map(renderFindingLine));
  }

  if (report.skipped.length > 0) {
    lines.push(``, `<details><summary>Not inspected (${report.skipped.length})</summary>`, ``);
    lines.push(...report.skipped.map((s) => `- \`${s.path}\` — ${s.reason}`));
    lines.push(``, `</details>`);
  }

  return lines;
}

/**
 * Renders the report-only half of the PR body.
 *
 * Kept visually and textually separate from the bump sections, and prefaced
 * with an explicit disclaimer, because everything above it was proven against
 * the repo's tests and nothing here was. Blurring that line would undermine
 * the one claim this tool actually makes.
 */
export function renderSecuritySection(scan: SecurityScan): string {
  return [
    `## Security findings — reported, not fixed`,
    ``,
    `Unlike the dependency bumps above, **nothing in this section has been changed or verified.**`,
    `These are detections for a human to triage. Secret values are redacted; a leaked credential`,
    `must be rotated at its source, which is not something this agent will do for you.`,
    ``,
    ...renderScanSection("Secrets", scan.secrets, "No credential patterns matched in tracked files."),
    ``,
    ...renderScanSection("Static analysis", scan.sast, "No static-analysis findings."),
  ].join("\n");
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
