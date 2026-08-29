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
- **Credential boundary** — **no write credential ever enters the sandbox.** A public-repo run carries no GitHub credential at all; a private-repo run gets a short-lived, read-only one from the harness purely to clone. The only irreversible action in a run (branch push + PR creation) is designed to happen outside the sandbox, through the GitHub MCP connector, behind the harness's own approval gate.

> **Status, stated plainly:** that last point is the one piece not yet wired end to end. The sandbox boundary is real and enforced — the agent genuinely cannot reach GitHub — but the MCP connector is not connected yet, so a completed run currently ends with an approved patch and PR body that a human pushes from outside the sandbox. Everything upstream of that (audit, plan, per-bump verification, both checkpoints, combine) runs unaided. We would rather document the gap than describe the finished design as if it were shipped.

## What a run actually produces

**Verification tiers — the labels never overstate the evidence.** The tier is decided once, on the untouched repo, before anything is bumped:

| Tier | Condition | What a green bump means |
|---|---|---|
| `tests` | the repo has a working test suite | strongest claim: **no new test failures** against the baseline |
| `build` | no usable tests, but a build command exists | build-verified only — *not* "safe" |
| `resolves` | neither; `npm ci` is all that runs | installs cleanly; **no** behavioural evidence |
| `none` | no `package.json`, or a test run that failed without naming any test | the agent reports this and stops |

Two details worth stating precisely, because the difference is exactly the kind of thing this tool must not blur:

- **Green means "no new failures", not "everything passes."** The baseline run records which tests were already red, and a bump stays green if every failure it produces was already failing before. If the suite fails in a way the runner's output can't be attributed to named tests, that counts as *unknown*, never as *fine*.
- **A failed baseline does not always stop the run.** Only a missing `package.json`, or a test run that fails without naming any test, produces tier `none`. A repo whose build or install is already broken still gets planned at the `build` or `resolves` tier — with correspondingly weaker labels on every bump.

Included bumps carry their tier label in the PR body. Excluded and skipped bumps are listed with the diagnosis instead, so read the `Baseline:` line at the top of the PR body for the tier the whole run was verified at. A `resolves`-tier bump is never described as safe. Guarding that distinction is why an unvalidated tier string was treated as a serious bug (see the Qodo section).

**Opportunistic upgrades.** For each advisory the agent first tries the package's *latest* published version, not just the minimum version that clears the CVE, and falls back to the audit-recommended target if latest fails verification. You get the best version that actually passes, with `usedOpportunisticFallback` recording which one it settled on.

**Evidence of a real run.** [`demo-vulnerable-app` PR #1](https://github.com/Mit4004/demo-vulnerable-app/pull/1) was produced by an actual end-to-end run against the fixture: four advisories found, each bump verified on its own branch, both checkpoints approved by a human. `node-fetch` is the interesting one — the agent tried latest (`3.3.2`) first, hit a genuine failure, diagnosed it, and fell back to `2.7.0`, which clears the advisory and keeps the app working. That is the behaviour the whole design exists to produce, and it was not scripted.

## Repo layout

```
src/            audit parsing, baseline detection, per-bump verification, combine, PR report
src/cli.ts      thin CLI over the above, so the agent drives it with plain shell commands
test/           unit tests for the pure functions (this is what Qodo reviews)
agent/SKILL.md  the playbook the harness loads and the agent follows
docs/           empirical harness findings
```

The split matters: `src/` does the work deterministically and `SKILL.md` supplies the judgment — what to attempt, how to explain a failure, what to write in the PR. The agent never re-derives audit or verification logic from a prompt; it calls `cli.js plan | verify-one | combine | report` and reads JSON back.

## Setup

Requires Node 22+.

```bash
npm install
npm test        # runs the unit suite (vitest)
npm run build   # type-checks and compiles src/ to dist/
```

Running the agent itself requires a local TrueForge instance (`npx @truefoundry/trueforge`) with a model provider and a Daytona sandbox key configured — see [docs/harness-findings.md](docs/harness-findings.md) for platform-specific notes (in particular: this does not currently run on native Windows; use WSL).

## Qodo Code Review Evidence

Every substantive change here goes through a branch and a pull request, and Qodo reviews each one. `main` is not written to directly.

**Representative PR: [#2 — Add opportunistic-upgrade attempts; fix real verify-loop bugs](https://github.com/Mit4004/Agent-Harness/pull/2).** It is the most substantive code in the repo — the verification loop itself — and it is where review pressure did the most good.

What Qodo has caught across the repo, and what we did about it:

| PR | Finding | Outcome |
|---|---|---|
| [#1](https://github.com/Mit4004/Agent-Harness/pull/1) | *Advertised agent files are missing* — the README documented an `agent/` directory that did not exist | Fixed in-PR; README corrected rather than the claim quietly dropped |
| [#2](https://github.com/Mit4004/Agent-Harness/pull/2) | *Test artifacts enter commits* — `combineGreens` staged the whole working tree, so anything the test run generated would ride along in the upgrade commit | Fixed in-PR: staging narrowed to `package.json` and `package-lock.json`, so a bump commit can only ever contain manifest changes |
| [#3](https://github.com/Mit4004/Agent-Harness/pull/3) | Four bugs, two of them **Security**: bump and branch fields were interpolated into shell command strings | Two security findings fixed in [#4](https://github.com/Mit4004/Agent-Harness/pull/4) (every call moved to `execFileSync` argument arrays); the remaining two fixed in [#5](https://github.com/Mit4004/Agent-Harness/pull/5) |
| [#4](https://github.com/Mit4004/Agent-Harness/pull/4) | None — *"no material issues"* | — |
| [#5](https://github.com/Mit4004/Agent-Harness/pull/5) | *Invalid tier yields false green* and *Audit tempfile races plans*, both carried over from #3 | Fixed, with regression tests |

> **Merge state, so the table isn't read as stronger than it is:** #4, #5 and this PR are open at the time of writing. Until #4 and #5 land, `main` still carries the interpolated `execSync` calls in `verify.ts` / `combine.ts`, still casts the CLI tier argument without validating it, and still writes the audit report to a shared tempfile. The rows above describe what each PR does, not what `main` contains today. Qodo's review of this README caught precisely that gap, which is a fair hit — merge #4 and #5 before #6.

**One process gap, disclosed rather than papered over.** PR #3 was merged while four Qodo findings were still open. #4 was opened as a follow-up and fixed the two security ones, but it did not touch `src/cli.ts`, so the other two survived on `main` until a later audit of the review history caught them — which is what #5 fixes. Two commits also reached `main` outside a PR: the initial scaffold, before the review process was set up, and a one-line docs commit.

The most valuable finding was the *false green* bug in #5, because of what it threatened rather than its size. The CLI cast an unvalidated tier string, and an unrecognised value silently fell through to the **build** command while the plan still reported **test-backed** evidence — a bump could be labelled green on weaker proof than claimed. The entire premise of this tool is that its evidence labels are trustworthy, so that one was worth the whole review process on its own.

Every open finding listed above is resolved as of #5. Where a finding was judged lower-severity than its rating (the tempfile race could only collide across two concurrent runs sharing one sandbox, not across the subagent fan-out), it was fixed anyway and the reasoning written down in the PR rather than left as a silent dismissal.

## AI-assistance disclosure

Portions of this codebase were scaffolded with an AI coding assistant, including the audit parser, the verification loop, and this README. The architecture, the verification-tier model, the fixture design, and all review decisions were made by the team. Both team members can walk through the full pipeline and explain any part of it on request.

## License

MIT — see [LICENSE](LICENSE).
