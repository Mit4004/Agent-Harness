import { describe, expect, it } from "vitest";
import { parseSemgrep } from "../src/sast.js";
import { renderSecuritySection } from "../src/report.js";
import type { SecurityScan } from "../src/types.js";

describe("parseSemgrep", () => {
  it("maps semgrep results onto the shared Finding shape", () => {
    const findings = parseSemgrep({
      results: [
        {
          check_id: "javascript.lang.security.audit.eval-detected",
          path: "src/run.js",
          start: { line: 12 },
          extra: { message: "Detected eval with user input", severity: "ERROR", lines: "eval(input)" },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: "sast",
      rule: "javascript.lang.security.audit.eval-detected",
      severity: "High",
      file: "src/run.js",
      line: 12,
    });
  });

  it("maps severities and defaults unknown ones to Low", () => {
    const sev = (s?: string) =>
      parseSemgrep({ results: [{ extra: { severity: s } }] })[0].severity;
    expect(sev("ERROR")).toBe("High");
    expect(sev("WARNING")).toBe("Medium");
    expect(sev("INFO")).toBe("Low");
    expect(sev(undefined)).toBe("Low");
  });

  it("handles empty or absent results", () => {
    expect(parseSemgrep({})).toEqual([]);
    expect(parseSemgrep({ results: [] })).toEqual([]);
  });
});

describe("renderSecuritySection", () => {
  const empty: SecurityScan = {
    secrets: { status: "ran", reason: null, findings: [], skipped: [] },
    sast: { status: "ran", reason: null, findings: [], skipped: [] },
  };

  it("states plainly that nothing here was verified", () => {
    const body = renderSecuritySection(empty);
    expect(body).toContain("reported, not fixed");
    expect(body).toContain("nothing in this section has been changed or verified");
  });

  // The distinction this whole ScanStatus type exists for: a scanner that
  // could not run must never render the same way as one that ran and found
  // nothing, or the PR implies a safety claim that was never established.
  it("distinguishes 'could not scan' from 'found nothing'", () => {
    const clean = renderSecuritySection(empty);
    expect(clean).toContain("No static-analysis findings");

    const unavailable = renderSecuritySection({
      ...empty,
      sast: { status: "unavailable", reason: "semgrep is not installed.", findings: [], skipped: [] },
    });
    expect(unavailable).toContain("Not scanned");
    expect(unavailable).toContain("semgrep is not installed.");
    expect(unavailable).not.toContain("No static-analysis findings");
  });

  it("orders findings by severity, worst first", () => {
    const body = renderSecuritySection({
      ...empty,
      sast: {
        status: "ran",
        reason: null,
        skipped: [],
        findings: [
          { id: "S1", kind: "sast", rule: "low-rule", severity: "Low", file: "a", line: 1, message: "m", excerpt: "" },
          { id: "S2", kind: "sast", rule: "crit-rule", severity: "Critical", file: "b", line: 2, message: "m", excerpt: "" },
        ],
      },
    });
    expect(body.indexOf("crit-rule")).toBeLessThan(body.indexOf("low-rule"));
  });
});

describe("SAST output never republishes a credential", () => {
  // The finding Qodo caught on PR #9: secret findings were redacted, but SAST
  // findings copied semgrep's raw matched line and rule message straight
  // through. A static-analysis rule that fires *on a hardcoded credential*
  // would therefore print that credential in the very report warning about it.
  const FAKE_AWS = "AKIAIOSFODNN7EXAMPLE";

  it("scrubs a credential out of the matched source line", () => {
    const findings = parseSemgrep({
      results: [
        {
          check_id: "hardcoded-credential",
          path: "src/config.js",
          start: { line: 3 },
          extra: { severity: "ERROR", message: "Hardcoded credential", lines: `key = "${FAKE_AWS}"` },
        },
      ],
    });
    expect(findings[0].excerpt).not.toContain(FAKE_AWS);
    expect(findings[0].excerpt).toContain("AKIA");
    expect(findings[0].excerpt).toContain("*");
  });

  it("scrubs a credential the rule interpolated into its message", () => {
    const findings = parseSemgrep({
      results: [{ extra: { message: `Found secret ${FAKE_AWS} in source`, severity: "ERROR" } }],
    });
    expect(findings[0].message).not.toContain(FAKE_AWS);
  });

  it("survives the whole way into rendered markdown", () => {
    const body = renderSecuritySection({
      secrets: { status: "ran", reason: null, findings: [], skipped: [] },
      sast: {
        status: "ran",
        reason: null,
        skipped: [],
        findings: parseSemgrep({
          results: [{ extra: { message: "x", severity: "ERROR", lines: `k="${FAKE_AWS}"` } }],
        }),
      },
    });
    expect(body).not.toContain(FAKE_AWS);
  });
});

describe("partial scans never read as clean", () => {
  const base: SecurityScan = {
    secrets: { status: "ran", reason: null, findings: [], skipped: [] },
    sast: { status: "ran", reason: null, findings: [], skipped: [] },
  };

  it("flags an incomplete scan even when it found nothing", () => {
    const body = renderSecuritySection({
      ...base,
      secrets: {
        status: "partial",
        reason: "2 tracked file(s) could not be inspected, so this is not a complete scan.",
        findings: [],
        skipped: [
          { path: "big.bin", reason: "larger than 1000000 bytes" },
          { path: "link.txt", reason: "symlink — not followed" },
        ],
      },
    });
    expect(body).toContain("Incomplete scan");
    expect(body).toContain("could not be inspected");
    // The unqualified all-clear line must NOT appear for a partial scan.
    expect(body).not.toContain("No credential patterns matched in tracked files.");
    expect(body).toContain("Not inspected (2)");
    expect(body).toContain("symlink — not followed");
  });
});
