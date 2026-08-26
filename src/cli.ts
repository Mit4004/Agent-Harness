#!/usr/bin/env node
// Thin CLI over the TS core so the agent (running in a sandbox) can drive
// the pipeline with plain shell commands and get JSON back at each stage,
// instead of re-deriving audit/verify/combine logic from scratch prompts.
// The agent's job is judgment (what to attempt, how to explain a failure,
// what to write in the PR) — this CLI's job is doing the work correctly.

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { parseAudit, getInstalledVersions, getLatestVersion } from "./audit.js";
import { runBaseline } from "./baseline.js";
import { verifyBumpWithOpportunisticUpgrade, type DiagnoseFn } from "./verify.js";
import { combineGreens } from "./combine.js";
import { renderPrBody } from "./report.js";
import type { Bump, BumpPlan } from "./types.js";

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
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
  return execSync("git rev-parse --abbrev-ref HEAD", { cwd: repoDir, encoding: "utf-8" }).trim();
}

function cmdPlan(repoDir: string): void {
  const baseBranch = currentBranch(repoDir);
  const baseline = runBaseline(repoDir);

  if (baseline.tier === "none") {
    printJson({ repo: repoDir, baseBranch, runId: `run-${Date.now()}`, baseline, bumps: [] });
    return;
  }

  execSync("npm audit --json > /tmp/.agent-audit.json || true", { cwd: repoDir, shell: "/bin/bash" });
  const auditJson = readJson<unknown>("/tmp/.agent-audit.json");
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
    tier as BumpPlan["baseline"]["tier"],
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
