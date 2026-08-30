import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSecretScan } from "../src/scan.js";

const FAKE_AWS = "AKIAIOSFODNN7EXAMPLE";

/**
 * Symlink creation needs Developer Mode or admin rights on Windows, so this
 * capability is probed rather than assumed. The suite skips instead of
 * failing where links can't be made — the agent itself runs on Linux in the
 * sandbox, which is where this boundary actually has to hold.
 */
function symlinksSupported(dir: string): boolean {
  try {
    const target = join(dir, "__probe-target");
    const link = join(dir, "__probe-link");
    writeFileSync(target, "x");
    symlinkSync(target, link);
    const ok = lstatSync(link).isSymbolicLink();
    rmSync(link, { force: true });
    rmSync(target, { force: true });
    return ok;
  } catch {
    return false;
  }
}

function git(repo: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: repo, stdio: "pipe" });
}

describe("runSecretScan", () => {
  let repo: string;
  let outsideSecret: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "scan-test-"));
    outsideSecret = join(tmpdir(), `outside-secret-${Date.now()}.txt`);
    writeFileSync(outsideSecret, `${FAKE_AWS}\n`);
    git(repo, "init");
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(outsideSecret, { force: true });
  });

  it("finds a credential in a tracked file", () => {
    writeFileSync(join(repo, "config.js"), `const k = "${FAKE_AWS}";`);
    git(repo, "add", "-A");
    const report = runSecretScan(repo);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].rule).toBe("aws-access-key-id");
    expect(report.findings[0].excerpt).not.toContain(FAKE_AWS);
  });

  // The security boundary Qodo flagged: a repository chooses its own symlink
  // targets, so following one would let an untrusted repo aim the scanner at
  // arbitrary host files and surface their contents in a report.
  it.skipIf(!symlinksSupported(tmpdir()))(
    "does not follow a tracked symlink pointing outside the repo",
    () => {
      const link = join(repo, "leaked-link.txt");
      symlinkSync(outsideSecret, link);
      git(repo, "add", "-A");

      const report = runSecretScan(repo);

      // The secret lives only outside the repo, so it must not appear at all.
      const fromLink = report.findings.filter((f) => f.file === "leaked-link.txt");
      expect(fromLink).toHaveLength(0);

      // And the skip must be recorded, not silent.
      expect(report.status).toBe("partial");
      expect(report.skipped.some((s) => s.path === "leaked-link.txt")).toBe(true);
      expect(report.skipped.find((s) => s.path === "leaked-link.txt")?.reason).toContain("symlink");

      rmSync(link, { force: true });
      git(repo, "add", "-A");
    },
  );
});
