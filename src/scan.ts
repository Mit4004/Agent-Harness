import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ScanReport, SecurityScan, SkippedFile } from "./types.js";
import { isScannablePath, scanContentForSecrets } from "./secrets.js";
import { runSast } from "./sast.js";

/** Files above this size are almost certainly assets, not hand-written source. */
const MAX_FILE_BYTES = 1_000_000;

/**
 * Lists the repo's tracked files via git rather than walking the filesystem,
 * so anything gitignored — build output, local env files, installed packages —
 * is out of scope automatically. A secret in an untracked `.env` is a local
 * hygiene problem; a secret in a *tracked* file is the one that gets published.
 */
function trackedFiles(repoDir: string): string[] {
  const output = execFileSync("git", ["ls-files"], {
    cwd: repoDir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
  return output.split("\n").filter(Boolean);
}

export function runSecretScan(repoDir: string): ScanReport {
  let files: string[];
  try {
    files = trackedFiles(repoDir);
  } catch (error) {
    return {
      status: "unavailable",
      reason: `Could not list tracked files: ${(error as Error).message.split("\n")[0]}`,
      findings: [],
      skipped: [],
    };
  }

  const findings = [];
  const skipped: SkippedFile[] = [];

  for (const file of files) {
    if (!isScannablePath(file)) continue;
    const full = join(repoDir, file);
    try {
      // lstat, not stat: a tracked symlink must be identified rather than
      // followed. The target of a symlink in a cloned repo is chosen by
      // whoever wrote the repo, so following one would let an untrusted
      // repository point the scanner at arbitrary host files or a blocking
      // device — reading content that was never part of the checkout.
      const stats = lstatSync(full);
      if (stats.isSymbolicLink()) {
        skipped.push({ path: file, reason: "symlink — not followed" });
        continue;
      }
      if (!stats.isFile()) continue;
      if (stats.size > MAX_FILE_BYTES) {
        skipped.push({ path: file, reason: `larger than ${MAX_FILE_BYTES} bytes` });
        continue;
      }
      findings.push(...scanContentForSecrets(file, readFileSync(full, "utf-8")));
    } catch (error) {
      skipped.push({ path: file, reason: `unreadable: ${(error as Error).message.split("\n")[0]}` });
    }
  }

  // Re-number across the whole repo so ids are unique in the final report.
  findings.forEach((finding, index) => {
    finding.id = `SEC-${String(index + 1).padStart(2, "0")}`;
  });

  if (skipped.length > 0) {
    return {
      status: "partial",
      reason: `${skipped.length} tracked file(s) could not be inspected, so this is not a complete scan.`,
      findings,
      skipped,
    };
  }

  return { status: "ran", reason: null, findings, skipped: [] };
}

export function runSecurityScan(repoDir: string): SecurityScan {
  return { secrets: runSecretScan(repoDir), sast: runSast(repoDir) };
}
