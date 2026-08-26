# Verified Dependency Upgrade Agent

A [TrueForge](https://trueforge.dev) agent that finds vulnerable npm dependencies, upgrades each one in isolation inside a sandbox, **proves each upgrade against the target repo's own test suite**, and opens a pull request containing only the bumps that passed — with the ones that broke something reported, explained, and left out.

Built for [The Agent Harness Hackathon](https://www.wemakedevs.org/hackathons/trueforge) (WeMakeDevs × TrueFoundry), Aug 24–30, 2026.

## Why this, not Dependabot / Snyk?

Dependabot opens upgrade PRs it can't vouch for — you merge on faith or review each one by hand. Snyk tells you which CVE to fix but not whether fixing it breaks you. Neither runs *your* test suite per bump.

This agent upgrades each vulnerable dependency on its own branch, runs the repo's tests against each one independently, and gives you a split: these upgrades are proven green, these ones broke the build and here's exactly why. A human approves the split before anything reaches GitHub. Only the verified-green bumps land in the PR.

See [docs/harness-findings.md](docs/harness-findings.md) for what we learned running TrueForge's sandbox in practice.

## How it uses TrueForge

- **Sandbox-as-tool** — clone, install, and test runs happen in a Daytona-backed sandbox, provisioned per session, not on the harness server itself.
- **Human checkpoints** — the agent pauses twice: once to approve the upgrade plan before touching anything, once to approve the final PR (fixed / excluded / skipped buckets) before any write to GitHub.
- **Subagents** — each candidate bump is verified on its own branch, in parallel, with its own clean context; only the pass/fail verdict returns to the root agent.
- **MCP Gateway** — the only irreversible action (branch push + PR creation) happens through GitHub's MCP connector, OAuth-authenticated, outside the sandbox — no long-lived credential ever enters the sandboxed environment.

## Repo layout

```
src/            audit parsing, baseline detection, per-bump verification, PR report rendering
test/           unit tests for the pure functions above (this is what Qodo reviews)
docs/           empirical harness findings (architecture notes and demo script to follow)
agent/          (planned) SKILL.md playbook + prompt templates the harness loads
```

`agent/` doesn't exist yet — it's next on the build plan, not yet part of this repo. Everything else above is already there.

## Setup

Requires Node 22+.

```bash
npm install
npm test        # runs the unit suite (vitest)
npm run build   # type-checks and compiles src/ to dist/
```

Running the agent itself requires a local TrueForge instance (`npx @truefoundry/trueforge`) with a model provider and a Daytona sandbox key configured — see [docs/harness-findings.md](docs/harness-findings.md) for platform-specific notes (in particular: this does not currently run on native Windows; use WSL).

## Qodo Code Review Evidence

This repository uses Qodo for review on every substantive pull request, per the hackathon's code-quality requirements. This section will link a representative merged, Qodo-reviewed PR and summarize what it caught once one lands — check back as the repo fills in over the hackathon week.

## AI-assistance disclosure

Portions of this codebase were scaffolded with an AI coding assistant, including the audit parser, the verification loop, and this README. The architecture, the verification-tier model, the fixture design, and all review decisions were made by the team. Both team members can walk through the full pipeline and explain any part of it on request.

## License

MIT — see [LICENSE](LICENSE).
