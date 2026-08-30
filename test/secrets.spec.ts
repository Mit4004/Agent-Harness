import { describe, expect, it } from "vitest";
import { isScannablePath, redact, scanContentForSecrets } from "../src/secrets.js";

// A fake key that matches the AWS pattern's shape without being a real
// credential. Kept obviously synthetic so this file never becomes the thing
// the scanner is supposed to catch.
const FAKE_AWS = "AKIAIOSFODNN7EXAMPLE";

describe("redact", () => {
  // The most important guarantee in this module. Reporting a leaked secret is
  // pointless if the report republishes it — to a PR body, a log, or the
  // model's context, all of which are wider audiences than the original commit.
  it("never returns the full secret", () => {
    const masked = redact(FAKE_AWS);
    expect(masked).not.toBe(FAKE_AWS);
    expect(masked).not.toContain("IOSFODNN7EXAMP");
  });

  it("keeps just enough for a human to locate the value", () => {
    const masked = redact(FAKE_AWS);
    expect(masked.startsWith("AKIA")).toBe(true);
    expect(masked.endsWith("MPLE")).toBe(true);
    expect(masked).toContain("*");
  });

  it("fully masks a short value rather than revealing most of it", () => {
    expect(redact("abc123")).toBe("******");
  });
});

describe("scanContentForSecrets", () => {
  it("detects an AWS access key id and reports it redacted", () => {
    const findings = scanContentForSecrets("src/config.js", `const key = "${FAKE_AWS}";`);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("aws-access-key-id");
    expect(findings[0].severity).toBe("Critical");
    expect(findings[0].line).toBe(1);
    expect(findings[0].excerpt).not.toContain("IOSFODNN7EXAMP");
  });

  it("reports the correct line number in a multi-line file", () => {
    const content = ["// header", "", `token = "${FAKE_AWS}"`].join("\n");
    expect(scanContentForSecrets("a.js", content)[0].line).toBe(3);
  });

  it("detects a private key block", () => {
    const findings = scanContentForSecrets("id_rsa", "-----BEGIN RSA PRIVATE KEY-----");
    expect(findings[0].rule).toBe("private-key-block");
  });

  it("finds every occurrence, not just the first", () => {
    // Guards the /g regex lastIndex reset — without it, module-level patterns
    // carry state between lines and silently skip matches.
    const content = [`a = "${FAKE_AWS}"`, `b = "${FAKE_AWS}"`].join("\n");
    expect(scanContentForSecrets("a.js", content)).toHaveLength(2);
  });

  it("returns nothing for ordinary source", () => {
    expect(scanContentForSecrets("a.js", "const x = 1;\nexport default x;")).toEqual([]);
  });
});

describe("isScannablePath", () => {
  it("skips dependency and build directories", () => {
    expect(isScannablePath("node_modules/foo/index.js")).toBe(false);
    expect(isScannablePath("dist/bundle.js")).toBe(false);
    expect(isScannablePath("coverage/lcov.info")).toBe(false);
  });

  it("skips generated build artifacts", () => {
    expect(isScannablePath("public/app.min.js")).toBe(false);
    expect(isScannablePath("public/app.js.map")).toBe(false);
  });

  // Deliberately scanned, not skipped: npm/yarn lockfiles can carry registry
  // credentials inside `resolved` URLs, so treating them as noise would miss
  // a real leak vector.
  it("still scans lockfiles, which can embed registry credentials", () => {
    expect(isScannablePath("package-lock.json")).toBe(true);
    expect(isScannablePath("yarn.lock")).toBe(true);
  });

  it("scans real source", () => {
    expect(isScannablePath("src/index.ts")).toBe(true);
    expect(isScannablePath(".env.example")).toBe(true);
  });
});
