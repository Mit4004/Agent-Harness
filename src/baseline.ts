import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Baseline, TierRunResult, VerifyTier } from "./types.js";

interface PackageJson {
  scripts?: Record<string, string>;
}

function readPackageJson(repoDir: string): PackageJson {
  const raw = readFileSync(join(repoDir, "package.json"), "utf-8");
  return JSON.parse(raw) as PackageJson;
}

/**
 * Tier 1 requires an actual `test` script — presence alone doesn't
 * guarantee it's meaningful, but absence rules tests out entirely.
 * Tier 2 requires a `build` script. Tier 3 falls back to `npm ci`
 * resolving cleanly, which is always attempted first regardless of tier.
 */
export function detectTier(repoDir: string): VerifyTier {
  const pkg = readPackageJson(repoDir);
  if (pkg.scripts?.test) return "tests";
  if (pkg.scripts?.build) return "build";
  return "resolves";
}

function run(cmd: string, repoDir: string): { ok: boolean; output: string } {
  try {
    const output = execSync(cmd, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
    return { ok: true, output };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ""}\n${e.stderr ?? ""}` };
  }
}

/**
 * Runs the command for a given tier and reports pass/fail plus raw output.
 * `failures` is best-effort test-name extraction; callers that only need
 * pass/fail (e.g. build/resolves tiers) can ignore it.
 */
export function runTier(repoDir: string, tier: VerifyTier): TierRunResult {
  // Validated up front, before any install work. Previously an unrecognised
  // tier fell through a `tests ? "npm test" : "npm run build"` ternary, so it
  // silently ran the *build* command and returned that as the tier's result —
  // the exact path by which a bump could be reported green on weaker evidence
  // than the plan claimed. Fail loudly instead, and fail before spending an
  // `npm ci` on a run that cannot produce a meaningful verdict.
  if (!["tests", "build", "resolves", "none"].includes(tier)) {
    throw new Error(`Unsupported verification tier: ${String(tier)}`);
  }

  if (tier === "none") {
    return { passed: false, failures: [], output: "" };
  }

  if (tier === "resolves") {
    const install = run("npm ci", repoDir);
    return { passed: install.ok, failures: [], output: install.output };
  }

  const install = run("npm ci", repoDir);
  if (!install.ok) {
    return { passed: false, failures: [], output: install.output };
  }

  const cmd = tier === "tests" ? "npm test" : "npm run build";
  const result = run(cmd, repoDir);
  const failures = tier === "tests" ? extractFailingTestNames(result.output) : [];
  return { passed: result.ok, failures, output: result.output };
}

/**
 * Best-effort extraction of failing test identifiers from common runner
 * output: jest/vitest/mocha "✗"/"FAIL" style lines, and TAP "not ok N -
 * description" lines (Node's built-in test runner, `node --test`). Used
 * only to diff baseline failures against post-bump failures — an empty
 * result here means "couldn't identify them", not "there aren't any", so
 * callers must never treat it as proof of a clean run on its own.
 */
function extractFailingTestNames(output: string): string[] {
  const lines = output.split("\n");
  const failing: string[] = [];
  for (const line of lines) {
    const tapMatch = line.match(/^not ok \d+ (?:-\s*)?(.+)$/);
    if (tapMatch) {
      failing.push(tapMatch[1].trim());
      continue;
    }
    const match = line.match(/^\s*(?:✗|✕|FAIL|×)\s+(.+)$/);
    if (match) failing.push(match[1].trim());
  }
  return failing;
}

export function runBaseline(repoDir: string): Baseline {
  if (!existsSync(join(repoDir, "package.json"))) {
    return { tier: "none", failingTests: [], durationMs: 0 };
  }

  const tier = detectTier(repoDir);
  const start = Date.now();
  const result = runTier(repoDir, tier);
  const durationMs = Date.now() - start;

  if (tier === "tests" && !result.passed && result.failures.length === 0) {
    return { tier: "none", failingTests: [], durationMs };
  }

  return { tier, failingTests: result.failures, durationMs };
}
