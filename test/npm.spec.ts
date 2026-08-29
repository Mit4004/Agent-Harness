import { describe, expect, it } from "vitest";
import { runNpm } from "../src/npm.js";

describe("runNpm", () => {
  // This is deliberately an integration test rather than a mocked one: the
  // entire point of npm.ts is that invoking npm actually resolves on the
  // current platform without a shell. Mocking the spawn would test nothing.
  //
  // It guards a real regression. PR #4 replaced interpolated execSync strings
  // with execFileSync("npm", ...), which fixed a command injection hole but
  // silently stopped working on Windows, where npm is npm.cmd. Because
  // getLatestVersion swallowed the failure and returned null, opportunistic
  // upgrades quietly stopped happening with no error anywhere.
  //
  // `--version` is used because it is offline, fast, and has a stable shape.
  it("invokes npm without a shell and returns its output", () => {
    expect(runNpm(["--version"]).trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("propagates a failure instead of returning empty output", () => {
    expect(() => runNpm(["run", "a-script-that-does-not-exist"])).toThrow();
  });
});
