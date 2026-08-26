# TrueForge harness findings (empirical, Wed Aug 26)

Notes from getting TrueForge running and probing its sandbox behavior before
building the verify loop on top of it. Kept here because the plan's design
(branch-per-bump, parallel subagents) depends on these being true.

## 1. TrueForge 0.1.4 does not run on native Windows

`npx @truefoundry/trueforge` crashes immediately on Windows (PowerShell, CMD,
and Git Bash all affected):

```
Failed to start server: Only URLs with a scheme in: file, data, and node
are supported by the default ESM loader. On Windows, absolute paths must
be valid file:// URLs. Received protocol 'c:'
```

This is an upstream bug: [truefoundry/trueforge#427](https://github.com/truefoundry/trueforge/issues/427).
A fix exists on an unmerged fork branch (`DracFiendMG/trueforge#windows-fix`,
[PR #435](https://github.com/truefoundry/trueforge/pull/435)) but it requires
building the full pnpm monorepo (5 packages including a frontend build) from
source — not a quick patch.

**Workaround used:** run TrueForge inside WSL2 (Ubuntu) with a real Linux-native
Node (installed via `nvm`, not the Windows Node exposed through PATH interop).
This also resolves a second win32-only warning (`LocalSandboxProvider supports
macOS and Linux only`), though we use Daytona as the sandbox provider anyway.

## 2. Sandbox filesystem state DOES persist across turns in the same session

This was the critical open question from the plan (§9 probe) — the whole
branch-per-bump verification design assumes a bump's branch/install/test state
survives from one agent turn to the next.

**Test:** turn 1 cloned a repo into `/tmp/probe/repo` and wrote a marker file.
Turn 2 — a separate API call, new turn, same session — read the marker file
back successfully:

```
$ cat /tmp/probe/repo/marker.txt
MARKER_ABC123
```

**Conclusion:** confirmed. The sandbox is scoped to the *session*, not the
turn. §6's design (checkout a branch, install, test, and come back to it
across multiple turns) works as written — no redesign needed.

## 3. The default sandbox image has no Node.js installed

A plain `node -v && npm -v` in a fresh sandbox returns `node: command not
found`. The Daytona snapshot TrueForge provisions by default is a minimal
base image, not a Node-ready one.

**Implication:** the agent's SKILL.md / first sandbox turn must explicitly
install Node (e.g. `curl -fsSL https://deb.nodesource.com/setup_22.x | ...`,
or vendor a custom Daytona snapshot with Node preinstalled) before any
`npm ci` / `npm audit` / `npm test` step. This should be step zero of the
pipeline, not assumed.

## 4. TrueForge has a full HTTP API — useful for scripted testing

`/api/v1/openapi.json` (docs at `/api/v1/docs`) exposes session/turn endpoints
that can be driven directly with curl, without going through the browser UI:

- `POST /api/v1/sessions` — create a session; agent can be an inline spec
  (`{"agent": {"spec": {"model": {...}, "config": {"sandbox": {"enabled": true}}}}}`)
- `POST /api/v1/sessions/{id}/turns` — send a turn;
  `input: [{"type": "user.message", "content": "..."}]`, `stream: false` to
  poll instead of consuming SSE
- `GET /api/v1/sessions/{id}/turns/{turn_id}` — poll; terminal `state.status`
  values are `done | cancelled | error` (not `completed`/`succeeded` — easy
  to get wrong when writing a polling loop)

This is how both probes above were actually run — useful for CI-style
smoke-testing the agent without a browser in the loop.

## 5. A cold Daytona sandbox build can surface as a misleading "credentials rejected" error

On the very first Daytona connection attempt, TrueForge's UI showed "Daytona
rejected the API key — check the credentials." The server log told a
different story: `PromiseTimeoutError: Timed out after 3000ms (sandbox
buildImage)` — TrueForge wraps the initial snapshot registration in a
hardcoded 3-second internal timeout, which a cold-start build can exceed
regardless of whether the key is valid.

**Confirmed not a key problem** by creating a sandbox directly from the
Daytona dashboard (succeeded instantly) and then retrying the TrueForge
connection once a snapshot already existed — it connected cleanly the second
time. Worth knowing in case it recurs on a different machine during the
hackathon: don't burn time regenerating keys before checking the server log.

## 6. Free-tier Gemini quota is far tighter than expected, and at least two limits stack

Running the full agent (not just our own test scripts) against the fixture
repo for the first time surfaced real numbers, not the ballpark figures we'd
planned around:

- **`gemini-3.1-pro-preview` has a free-tier limit of `0`** on this account
  — not low, structurally zero. Don't budget any Pro usage on a fresh free
  key without checking first.
- **`gemini-3.6-flash`** hit 429s at two different reported thresholds in
  the same session — `limit: 5` early on, `limit: 20` a few minutes later.
  Read that as *at least two overlapping quota windows* (short-burst and
  something longer), not one simple per-minute cap.
- After the `limit: 20` wall, three consecutive retries — including one
  after a 65-second wait — all failed **instantly** with 0 tokens spent.
  A per-minute limit would have cleared by then. This pattern (instant
  rejection regardless of wait, after real usage earlier in the session)
  is what a **daily** quota exhausting mid-afternoon looks like, not a
  per-minute one recovering.

**Implication for the team:** budget model calls like a genuinely scarce
resource from the start of a session, not just "avoid bursts." A single
real agent run (one target repo, 4 dependencies, one Checkpoint A) spent
enough of the day's Flash allowance to make a second full run impossible
the same day. Get each teammate their own key (from a separate Google
account) now rather than discovering this mid-demo-recording — the plan's
§7 called this out as a mitigation before we knew how sharp the edge was.
