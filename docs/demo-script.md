# Demo script — 3 minutes

Shot-by-shot for the submission video. Written against what the pipeline
**actually does today**, not against the original plan: there is no GitHub MCP
connector wired yet, so the run ends with an approved patch and PR body that a
human pushes. That is said out loud rather than edited around — see §"The
credential boundary" below for why it is a strength, not an apology.

---

## Pre-flight — do all of this before you hit record

Everything here has bitten us at least once.

**1. Restart TrueForge.** It does not survive a session teardown. From Git Bash:

```bash
wsl -- bash -c '. /home/hp/.nvm/nvm.sh && cd /mnt/e/AgentHarness && npx @truefoundry/trueforge'
```

Confirm it answers before you rely on it — a stale process can reply `200` for a
few seconds and then vanish:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8790
wsl -- bash -c 'pgrep -af trueforge'
```

**2. Check the model actually has quota left.** Free-tier quota is **per model**,
so one model being spent says nothing about the others. Probe the real endpoint —
listing models returns `200` even for a key that cannot generate:

```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent?key=$KEY" \
  -H 'Content-Type: application/json' \
  -d '{"contents":[{"parts":[{"text":"Reply with the single word OK"}]}]}'
```

If it 429s, read `quotaId`. A `...PerDay...` quota will **not** clear by waiting,
and a second key from the same Google account shares the same pool. Switch model
before switching key. Fallback order: `gemini-3.5-flash` → `gemini-3.5-flash-lite`
→ `gemini-3.1-flash-lite`.

**3. Record in the morning, on fresh daily quota.** Dry run first, then record.

**4. Reset the fixture.** `demo-vulnerable-app` `main` must still be vulnerable —
`npm audit` should exit non-zero with four advisories. Do **not** merge PR #1
there; it is the agent's output, kept open as evidence.

**5. Have the failure ready to point at.** The node-fetch fallback is the best
ten seconds in the run. Know where it appears on screen before you record.

---

## The shots

| Time | Shot | What to say |
|---|---|---|
| **0:00–0:20** | The problem. A repo with a pile of Dependabot PRs. | "Dependabot opened twelve PRs. Which of these are safe to merge? Nobody knows without running them — so they sit there." |
| **0:20–0:35** | Paste the repo URL into TrueForge. Sandbox starts. | "The agent works in a sandbox. It gets a read-only clone credential and nothing else — it has no way to write to GitHub at all." |
| **0:35–0:55** | Clone, `npm ci`, baseline test run. | "First it establishes a baseline, so we know what was already broken before it touched anything. Four dependencies, tests currently green." |
| **0:55–1:15** | Audit → plan → **Checkpoint A**. | "Four real advisories. It's proposing patch bumps for three and flagging node-fetch as the awkward one. Nothing has been changed yet — this is a scope gate, and I have to approve it." |
| **1:15–1:50** | Subagents verify in parallel, one branch per bump. | "Each bump gets its own branch and its own test run. Not 'do these versions exist' — does *this repo's* suite still pass with this exact change." |
| **1:50–2:15** | **The failure.** node-fetch. | "Here's the one that matters. It tried node-fetch 3 first, because 3 is latest and clears the advisory outright. It broke — v3 doesn't hand back a callable `fetch` under `require`. It read the actual failure, and fell back to 2.7.0, which patches the CVE and keeps the app working. That's judgment, not version bumping." |
| **2:15–2:40** | **Checkpoint B** — three buckets + the diff + draft PR body. | "Everything verified green, with the evidence tier attached to each one. If a bump had failed, it would be sitting in the excluded bucket with the reason attached — reported, not hidden." |
| **2:40–2:55** | The PR on GitHub. | "Every bump labelled with the evidence that backs it. And the agent never merges — that stays a human decision." |
| **2:55–3:00** | Close. | "It doesn't tell you what's vulnerable. It tells you what's *safe to take*, and shows its work." |

---

## The credential boundary — say this, don't hide it

At **0:20** you claim the sandbox cannot write to GitHub. That is true and it is
worth being specific about, because it is also why a human does the final push:

> "The sandbox has no write credential — by design. The push and the PR are
> meant to go through the harness's MCP gateway, outside the sandbox, behind one
> more approval. That connector isn't wired yet, so right now I take the approved
> patch and open the PR myself. The boundary is real either way: the agent
> genuinely cannot reach GitHub."

Volunteering the gap reads as engineering judgment. Being caught on it in Q&A
does not.

---

## Two honesty points worth landing

They cost about eight seconds each and they are the most defensible things in
the submission.

**Evidence tiers.** "Every bump carries the tier it was verified at. Green at the
`tests` tier means no *new* test failures against the baseline — not that
everything passes, because the baseline may already have been red. If we can
only resolve the install, we say 'installs cleanly, no test evidence.' We never
call that safe."

**Optional: session persistence** (~15s, cut first if you are over time). Kill
the TrueForge server mid-run and restart it. Session state is in SQLite and
survives. "I just killed the server. It picks up where it left off."

---

## Cut order if you run long

1. Session-persistence restart
2. Checkpoint B walkthrough → just show the approval
3. Baseline shot → mention it over the audit shot instead

**Never cut:** the node-fetch failure, either checkpoint, or the tier honesty
line. Those are the submission.
