import { describe, expect, it } from "vitest";
import { parseAudit } from "../src/audit.js";

describe("parseAudit", () => {
  it("turns a fixable advisory into a candidate bump", () => {
    const auditJson = {
      vulnerabilities: {
        "node-fetch": {
          name: "node-fetch",
          severity: "high",
          range: "<2.6.7",
          fixAvailable: { name: "node-fetch", version: "2.6.7", isSemVerMajor: false },
          via: [
            {
              source: 1,
              title: "node-fetch forwards secure headers to untrusted sites",
              url: "https://github.com/advisories/GHSA-r683-j2x4-v87g",
            },
          ],
        },
      },
    };

    const bumps = parseAudit(auditJson, { "node-fetch": "2.6.0" });

    expect(bumps).toHaveLength(1);
    expect(bumps[0]).toMatchObject({
      package: "node-fetch",
      current: "2.6.0",
      target: "2.6.7",
      severity: "High",
      bumpKind: "patch",
      advisory: "GHSA-r683-j2x4-v87g",
      result: "pending",
    });
  });

  it("classifies a major version bump correctly", () => {
    const auditJson = {
      vulnerabilities: {
        "node-fetch": {
          name: "node-fetch",
          severity: "high",
          range: "<3.0.0",
          fixAvailable: { name: "node-fetch", version: "3.3.2", isSemVerMajor: true },
          via: [{ source: 1, title: "advisory", url: "https://github.com/advisories/GHSA-xxxx" }],
        },
      },
    };

    const bumps = parseAudit(auditJson, { "node-fetch": "2.6.0" });
    expect(bumps[0].bumpKind).toBe("major");
  });

  it("skips advisories with no available fix", () => {
    const auditJson = {
      vulnerabilities: {
        "some-pkg": {
          name: "some-pkg",
          severity: "low",
          range: "*",
          fixAvailable: false,
          via: ["some-other-pkg"],
        },
      },
    };

    expect(parseAudit(auditJson, {})).toHaveLength(0);
  });

  it("returns an empty list for a clean audit", () => {
    expect(parseAudit({ vulnerabilities: {} }, {})).toEqual([]);
  });
});
