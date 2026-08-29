import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * How to invoke npm as a child process without going through a shell.
 *
 * Moving off interpolated `execSync` strings (PR #4) removed a real command
 * injection risk, but `execFileSync("npm", ...)` does not work everywhere:
 * on Windows npm is `npm.cmd`, which execFileSync cannot resolve via PATHEXT
 * and which Node 24 refuses to spawn without a shell. Turning the shell back
 * on would undo the fix, because with `shell: true` the arguments are
 * concatenated rather than escaped -- and these arguments include package
 * names and versions taken from an audit report.
 *
 * So on Windows we run npm's own JS entry point under the current node
 * binary. No shell, arguments stay a real array, and the injection fix holds.
 */
function resolveNpm(): { file: string; leadingArgs: string[] } {
  if (process.platform !== "win32") {
    return { file: "npm", leadingArgs: [] };
  }

  const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(npmCli)) {
    return { file: process.execPath, leadingArgs: [npmCli] };
  }

  // Deliberately an error rather than a shell fallback. A shell here would
  // silently re-open the injection hole; failing loudly sends the developer
  // to WSL, which is the documented way to run this on Windows anyway.
  throw new Error(
    "Could not locate npm-cli.js next to the node binary, and refusing to fall back to a shell. Run this under WSL or a Node install that bundles npm.",
  );
}

/** Runs npm with the given arguments and returns stdout. Never uses a shell. */
export function runNpm(args: string[], options: ExecFileSyncOptions = {}): string {
  const { file, leadingArgs } = resolveNpm();
  const output = execFileSync(file, [...leadingArgs, ...args], {
    encoding: "utf-8",
    stdio: "pipe",
    ...options,
  });
  return typeof output === "string" ? output : output.toString();
}
