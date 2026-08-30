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
    secrets: { status: "ran", reason: null, findings: [] },
    sast: { status: "ran", reason: null, findings: [] },
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
      sast: { status: "unavailable", reason: "semgrep is not installed.", findings: [] },
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
        findings: [
          { id: "S1", kind: "sast", rule: "low-rule", severity: "Low", file: "a", line: 1, message: "m", excerpt: "" },
          { id: "S2", kind: "sast", rule: "crit-rule", severity: "Critical", file: "b", line: 2, message: "m", excerpt: "" },
        ],
      },
    });
    expect(body.indexOf("crit-rule")).toBeLessThan(body.indexOf("low-rule"));
  });
});
