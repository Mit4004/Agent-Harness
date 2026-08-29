import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Bump, BumpKind } from "./types.js";

interface NpmAuditAdvisory {
  severity: "info" | "low" | "moderate" | "high" | "critical";
  name: string;
  range: string;
  fixAvailable?:
    | boolean
    | { name: string; version: string; isSemVerMajor: boolean };
  via: Array<string | { source: number; title: string; url: string }>;
}

interface NpmAuditJson {
  vulnerabilities: Record<
    string,
    NpmAuditAdvisory & { name: string }
  >;
}

/**
 * Confirms a parsed `npm audit --json` payload is a real audit report before
 * anything tries to read advisories out of it.
 *
 * This exists because npm audit exits non-zero for two very different reasons:
 * it found advisories (the normal case here) or it failed operationally --
 * registry unreachable, auth rejected, bad config. Both can still print JSON.
 * Since `parseAudit` reads `vulnerabilities ?? {}`, an error payload would
 * otherwise sail through as zero bumps and be reported as a clean plan, which
 * is precisely the "claim more safety than the evidence supports" failure this
 * tool exists to prevent. An unusable report must stop the run, not empty it.
 */
export function assertUsableAuditReport(report: unknown): NpmAuditJson {
  if (typeof report !== "object" || report === null) {
    throw new Error("npm audit did not return a JSON object.");
  }

  const candidate = report as { error?: unknown; vulnerabilities?: unknown };

  if (candidate.error !== undefined) {
    const detail =
      typeof candidate.error === "object" && candidate.error !== null
        ? JSON.stringify(candidate.error)
        : String(candidate.error);
    throw new Error(`npm audit reported an error instead of a report: ${detail}`);
  }

  if (
    typeof candidate.vulnerabilities !== "object" ||
    candidate.vulnerabilities === null
  ) {
    throw new Error(
      "npm audit output has no 'vulnerabilities' map -- treating this as a failed audit rather than as zero vulnerabilities.",
    );
  }

  return report as NpmAuditJson;
}

const SEVERITY_MAP: Record<NpmAuditAdvisory["severity"], Bump["severity"]> = {
  critical: "Critical",
  high: "High",
  moderate: "Medium",
  low: "Low",
  info: "Low",
};

function classifyBumpKind(current: string, target: string): BumpKind {
  const [curMajor] = current.split(".");
  const [tgtMajor] = target.split(".");
  if (curMajor !== tgtMajor) return "major";
  const [, curMinor] = current.split(".");
  const [, tgtMinor] = target.split(".");
  if (curMinor !== tgtMinor) return "minor";
  return "patch";
}

interface PackageLockJson {
  packages?: Record<string, { version?: string }>;
}

/**
 * Reads installed versions from package-lock.json (v2/v3 "packages" map).
 * Top-level deps live under `node_modules/<name>` with no further nesting.
 */
export function getInstalledVersions(repoDir: string): Record<string, string> {
  const raw = readFileSync(join(repoDir, "package-lock.json"), "utf-8");
  const lock = JSON.parse(raw) as PackageLockJson;
  const versions: Record<string, string> = {};

  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    const match = path.match(/^node_modules\/([^/]+(?:\/[^/]+)?)$/);
    if (match && entry.version) {
      versions[match[1]] = entry.version;
    }
  }

  return versions;
}

function advisoryId(via: NpmAuditAdvisory["via"]): string {
  const withUrl = via.find(
    (v): v is { source: number; title: string; url: string } =>
      typeof v === "object" && "url" in v,
  );
  if (!withUrl) return "unknown-advisory";
  const match = withUrl.url.match(/GHSA-[a-z0-9-]+/i);
  return match ? match[0] : withUrl.url;
}

/**
 * Parses `npm audit --json` output into candidate bumps.
 * Only packages with a known fix version become candidates — advisories
 * with no available fix are reported separately by the caller, not bumped.
 *
 * `installedVersions` (name -> version, read from package-lock.json by
 * the caller) supplies the actual current version. The audit JSON's own
 * `range` field describes the *vulnerable* range, not what's installed —
 * using it as "current" silently corrupts patch/minor/major classification.
 */
export function parseAudit(json: unknown, installedVersions: Record<string, string>): Bump[] {
  const parsed = json as NpmAuditJson;
  const bumps: Bump[] = [];

  for (const [pkgName, vuln] of Object.entries(parsed.vulnerabilities ?? {})) {
    if (!vuln.fixAvailable || typeof vuln.fixAvailable === "boolean") {
      continue;
    }

    const target = vuln.fixAvailable.version;
    const current = installedVersions[pkgName] ?? vuln.range.replace(/^[\^~<>=]+/, "");

    bumps.push({
      id: `B-${String(bumps.length + 1).padStart(2, "0")}`,
      package: pkgName,
      current,
      target,
      advisory: advisoryId(vuln.via),
      severity: SEVERITY_MAP[vuln.severity],
      bumpKind: classifyBumpKind(current, target),
      strategyNote: "",
      branch: `bump/${pkgName}-${target}`,
      verifyTier: "none",
      baselineFailures: 0,
      result: "pending",
      failureExcerpt: null,
      diagnosis: null,
      recommendation: null,
      attempts: 0,
      latestVersion: null,
      usedOpportunisticFallback: false,
    });
  }

  return bumps;
}

/**
 * Looks up a package's latest published version from the registry.
 * Returns null on any failure (offline, unpublished, typo) rather than
 * throwing — the opportunistic-upgrade check is a bonus, not a
 * requirement, and its absence should never block the safe audit fix.
 */
export function getLatestVersion(pkg: string): string | null {
  try {
    const output = execFileSync("npm", ["view", pkg, "version"], { encoding: "utf-8", stdio: "pipe" });
    const version = output.trim();
    return version || null;
  } catch {
    return null;
  }
}
