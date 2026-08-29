#!/usr/bin/env node
// Thin CLI over the TS core so the agent (running in a sandbox) can drive
// the pipeline with plain shell commands and get JSON back at each stage,
// instead of re-deriving audit/verify/combine logic from scratch prompts.
// The agent's job is judgment (what to attempt, how to explain a failure,
// what to write in the PR) — this CLI's job is doing the work correctly.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseAudit, getInstalledVersions, getLatestVersion, assertUsableAuditReport } from "./audit.js";
import { runNpm } from "./npm.js";
import { runBaseline } from "./baseline.js";
import { verifyBumpWithOpportunisticUpgrade, type DiagnoseFn } from "./verify.js";
import { combineGreens } from "./combine.js";
import { renderPrBody } from "./report.js";
import type { Bump, BumpPlan, VerifyTier } from "./types.js";

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

const VERIFY_TIERS = ["tests", "build", "resolves", "none"] as const;

/**
 * Validates a tier string coming off the command line instead of casting it.
 * A bare `as VerifyTier` was actively dangerous here: runTier used to treat any
 * unrecognised tier as the build tier, while the green/failed classification
 * treated it as a non-test tier — so a near-miss like "test" (singular) would
 * verify a bump by *building* it and still report it green, under a plan that
 * claims test-backed evidence. Overstating the evidence is the one thing this
 * tool must never do, so an unknown tier is a hard error, not a fallback.
 */
function parseTier(raw: string): VerifyTier {
  if ((VERIFY_TIERS as readonly string[]).includes(raw)) {
    return raw as VerifyTier;
  }
  process.stderr.write(
    `Invalid tier ${JSON.stringify(raw)}. Expected one of: ${VERIFY_TIERS.join(", ")}.\n`,
  );
  process.exit(1);
}

/**
 * Placeholder diagnosis: the tail of the raw output. Good enough to
 * classify green/failed correctly and to hand a real diagnosis-writer
 * something to work with — it is NOT a substitute for the agent reading
 * `failureExcerpt` itself and writing an actual plain-English explanation
 * when it presents results to the user. See SKILL.md.
 */
const stubDiagnose: DiagnoseFn = ({ bump, output }) => {
  const tail = output.trim().split("\n").slice(-5).join(" | ");
  return {
    diagnosis: `${bump.package}@${bump.target} failed verification. Tail of output: ${tail}`,
    recommendation: "See failureExcerpt for the full output and diagnose the real cause before writing this up.",
  };
};

function currentBranch(repoDir: string): string {
  return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoDir, encoding: "utf-8" }).trim();
}

/**
 * Runs `npm audit --json` and returns the parsed report.
 *
 * Reads stdout directly rather than redirecting to a fixed path. The previous
 * `> /tmp/.agent-audit.json` was a shared filename, so two runs using the same
 * sandbox would overwrite and then read each other's audit output -- planning
 * one repo's bumps from another repo's advisories. Capturing stdout also drops
 * the `/bin/bash` dependency and the `|| true`, which existed only because npm
 * audit exits non-zero whenever it finds advisories, i.e. the normal case here.
 */
function runAudit(repoDir: string): unknown {
  let stdout: string;
  try {
    stdout = runNpm(["audit", "--json"], {
      cwd: repoDir,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    // Expected whenever advisories exist: npm exits non-zero but still writes
    // the full JSON report to stdout. Only genuinely empty output is fatal --
    // otherwise a real npm failure would be parsed as "no vulnerabilities".
    const captured = (error as { stdout?: string | Buffer }).stdout;
    stdout = captured ? captured.toString() : "";
    if (!stdout.trim()) {
      throw error;
    }
  }

  // A non-zero exit with output on stdout is not proof the audit succeeded --
  // npm exits non-zero both for "advisories found" and for operational
  // failures, and some of those still print JSON. Validate the shape so a
  // registry or auth failure stops the run instead of being parsed into an
  // empty, falsely reassuring plan.
  return assertUsableAuditReport(JSON.parse(stdout) as unknown);
}

function cmdPlan(repoDir: string): void {
  const baseBranch = currentBranch(repoDir);
  const baseline = runBaseline(repoDir);

  if (baseline.tier === "none") {
    printJson({ repo: repoDir, baseBranch, runId: `run-${Date.now()}`, baseline, bumps: [] });
    return;
  }

  const auditJson = runAudit(repoDir);
  const installedVersions = getInstalledVersions(repoDir);
  const bumps: Bump[] = parseAudit(auditJson, installedVersions).map((bump) => ({
    ...bump,
    latestVersion: getLatestVersion(bump.package),
  }));

  const plan: BumpPlan = { repo: repoDir, baseBranch, runId: `run-${Date.now()}`, baseline, bumps };
  printJson(plan);
}

function cmdVerifyOne(repoDir: string, baseBranch: string, bumpFile: string, baselineFailuresFile: string, tier: string): void {
  const bump = readJson<Bump>(bumpFile);
  const baselineFailures = readJson<string[]>(baselineFailuresFile);
  const verified = verifyBumpWithOpportunisticUpgrade(
    repoDir,
    bump,
    baselineFailures,
    parseTier(tier),
    stubDiagnose,
    baseBranch,
    bump.latestVersion,
  );
  printJson(verified);
}

function cmdCombine(repoDir: string, planFile: string): void {
  const plan = readJson<BumpPlan>(planFile);
  const result = combineGreens(repoDir, plan, plan.baseline.tier);
  printJson(result);
}

function cmdReport(planFile: string): void {
  const plan = readJson<BumpPlan>(planFile);
  process.stdout.write(renderPrBody(plan) + "\n");
}

const [, , command, ...args] = process.argv;

switch (command) {
  case "plan":
    cmdPlan(args[0]);
    break;
  case "verify-one":
    cmdVerifyOne(args[0], args[1], args[2], args[3], args[4]);
    break;
  case "combine":
    cmdCombine(args[0], args[1]);
    break;
  case "report":
    cmdReport(args[0]);
    break;
  default:
    process.stderr.write(
      "Usage: cli.js <plan|verify-one|combine|report> ...\n" +
        "  plan <repoDir>\n" +
        "  verify-one <repoDir> <baseBranch> <bumpFile.json> <baselineFailuresFile.json> <tier>\n" +
        "  combine <repoDir> <planFile.json>\n" +
        "  report <planFile.json>\n",
    );
    process.exit(1);
}
