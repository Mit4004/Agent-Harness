import type { Finding } from "./types.js";

/**
 * High-confidence credential patterns. Deliberately narrow: this scanner is
 * report-only and a human reads every hit, so a false positive costs attention
 * and trust. Broad entropy heuristics were left out for that reason — they fire
 * on minified assets, hashes, and base64 fixtures far more often than on real
 * secrets, and a scanner people learn to ignore is worse than no scanner.
 */
interface SecretRule {
  id: string;
  description: string;
  severity: Finding["severity"];
  pattern: RegExp;
}

const RULES: SecretRule[] = [
  {
    id: "aws-access-key-id",
    description: "AWS access key ID",
    severity: "Critical",
    pattern: /\b((?:AKIA|ASIA)[0-9A-Z]{16})\b/g,
  },
  {
    id: "github-token",
    description: "GitHub personal access / app token",
    severity: "Critical",
    pattern: /\b(gh[pousr]_[A-Za-z0-9]{36,255})\b/g,
  },
  {
    id: "slack-token",
    description: "Slack API token",
    severity: "High",
    pattern: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
  },
  {
    id: "google-api-key",
    description: "Google API key",
    severity: "High",
    pattern: /\b(AIza[0-9A-Za-z_-]{35})\b/g,
  },
  {
    id: "stripe-secret-key",
    description: "Stripe secret key",
    severity: "Critical",
    pattern: /\b(sk_(?:live|test)_[0-9A-Za-z]{16,})\b/g,
  },
  {
    id: "private-key-block",
    description: "Private key block",
    severity: "Critical",
    pattern: /(-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----)/g,
  },
  {
    id: "npm-token",
    description: "npm access token",
    severity: "High",
    pattern: /\b(npm_[A-Za-z0-9]{36})\b/g,
  },
];

/**
 * Masks a matched credential so it can be reported without being republished.
 *
 * This is the single most important function in this file. The whole point of
 * reporting a leaked secret is that it is sensitive — writing the raw value
 * into a PR body, a log line, or the model's context would leak it again, to a
 * wider audience than the original commit. Only enough is kept to let a human
 * locate the value in the file.
 */
export function redact(secret: string): string {
  if (secret.length <= 8) return "*".repeat(secret.length);
  return `${secret.slice(0, 4)}${"*".repeat(Math.min(secret.length - 8, 24))}${secret.slice(-4)}`;
}

/**
 * Paths that are generated noise rather than source, and would drown real
 * findings. Lockfiles are deliberately NOT excluded: npm and yarn lockfiles
 * can embed registry credentials inside `resolved` URLs, which makes them a
 * real leak vector rather than just noise. The file-size cap in scan.ts keeps
 * large ones from dominating a run.
 */
const IGNORED_PATH = /(^|\/)(node_modules|dist|build|coverage|\.git|vendor)(\/|$)|\.(min\.js|map)$/;

export function isScannablePath(path: string): boolean {
  return !IGNORED_PATH.test(path);
}

/**
 * Scans already-read file contents for credential patterns.
 *
 * Takes content rather than reading from disk so it stays a pure function —
 * trivially testable, and it cannot be pointed at a path by accident.
 */
export function scanContentForSecrets(path: string, content: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split("\n");

  lines.forEach((line, index) => {
    for (const rule of RULES) {
      // Reset between lines: the rules are module-level and /g regexes carry
      // lastIndex across calls, which would silently skip matches otherwise.
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.pattern.exec(line)) !== null) {
        findings.push({
          id: `SEC-${String(findings.length + 1).padStart(2, "0")}`,
          kind: "secret",
          rule: rule.id,
          severity: rule.severity,
          file: path,
          line: index + 1,
          message: `${rule.description} appears to be committed in source.`,
          excerpt: redact(match[1] ?? match[0]),
        });
      }
    }
  });

  return findings;
}
