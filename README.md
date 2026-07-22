# Chariot — Autonomous Build Loop

This repo drives a Codex loop that **builds** the Chariot ride-coordination system against an
already-finished PRD. Codex does not write the PRD — it reads it as a fixed spec and implements the
software, one checklist row at a time, with a `plan → build → test → commit → push` cycle per row.

| Path | Purpose |
|---|---|
| [`AGENTS.md`](AGENTS.md) | **Auto-read by Codex every session** (confirmed real Codex CLI behavior). Defines the two-tier rule for when Codex proceeds on its own vs. stops to ask a human — read this first. |
| [`documentation/Chariot_PRD_v1.3.md`](documentation/Chariot_PRD_v1.3.md) | The finished PRD — sole source of requirements. Codex reads from this; it does not edit it. |
| [`documentation/seed-data/`](documentation/seed-data/) | Pilot church's 19-point pickup registry + pairwise distances, provided directly rather than computed via any API. |
| [`.prd_loop/GOAL.md`](.prd_loop/GOAL.md) | The durable objective and the per-turn plan/build/test/commit/push cycle. |
| [`.prd_loop/CHECKLIST.md`](.prd_loop/CHECKLIST.md) | The dependency-ordered build checklist (49 rows, Phase 0–7), each row mapped to exact PRD requirement IDs, plus a final full-coverage cross-check row (45). |
| [`.prd_loop/PROGRESS.md`](.prd_loop/PROGRESS.md) | Status table Codex updates every turn — the mechanism that tracks what's Done/Missing/Skipped and drives the next row picked. |
| [`.codex/config.toml`](.codex/config.toml) | Two real profiles: `build` (autonomous command execution within the repo) and `verifier` (read-only, always prompts). |

## Correcting the earlier plan

The original setup for this loop assumed a `/goal` command and a `rollout_budget` config key. Neither
exists — verified directly against OpenAI's official Codex CLI documentation (not secondary blogs).
What's actually real and now reflected here: `AGENTS.md` auto-loading, `[profiles.NAME]` in
`config.toml` with real `sandbox_mode`/`approval_policy` values, and Codex Remote (ChatGPT mobile
pairing for monitoring/approving a running session from your phone — genuinely real, GA). There is
**no native cap** on tokens/turns/time for an unattended run — check in periodically rather than
trusting a budget signal to stop it for you.

Because `.prd_loop/` isn't repo root, Codex won't discover those specific files by default —
`AGENTS.md` *is* auto-loaded and tells Codex where to find them, but you still need to kick off work
on a given turn explicitly.

## Running it via the Codex desktop app window (not the CLI)

`config.toml` profiles and `AGENTS.md` are shared across the desktop app, CLI, IDE extension, and
SDK — confirmed the same source of truth either way. What's different in the app:

- **Model**: pick it from the composer's model dropdown before sending your first message. Use
  **GPT-5.6 Sol** (flagship reasoning tier) for normal build turns — matches `[profiles.build]`'s
  `model = "gpt-5.6-sol"`. Switch to **GPT-5.6 Terra** (balanced/cheaper, documented as strong for
  read-heavy review) for a verification pass — matches `[profiles.verifier]`. I can't confirm the
  app has a profile-selector UI that reads `[profiles.build]`/`[profiles.verifier]` automatically
  the way `codex --profile X` does on the CLI — safest bet is to pick the model by hand each time.
- **No confirmed background/unattended-loop feature in the app itself.** The docs describe
  multi-turn work as needing manual follow-up messages, not autonomous continuation — so
  `scripts/run-loop.sh` (built for the CLI's `codex exec`) has no direct equivalent here. Two ways
  to still get "mostly unattended" out of the app:
  1. In your **first message**, explicitly tell it not to stop and wait after finishing a row —
     to automatically move to the next `Missing` row per `GOAL.md` and only pause for a genuine
     `AGENTS.md` Tier 2 situation. Whether it actually keeps chaining rows across a long session
     without pausing depends on the app's own turn-taking behavior, which I haven't been able to
     verify directly — watch the first few rows to see how far it goes before stopping on its own.
  2. **Pair Codex Remote** (desktop app sidebar → "Set up Remote" → scan the QR code with the
     ChatGPT mobile app). This is the realistic "walk away" pattern for the GUI path: start the
     session, then handle approvals and Tier-2 escalations from your phone instead of sitting at
     the machine — genuinely real and GA, unlike the fictional features from earlier.

First message to send in the app window:
```
Read AGENTS.md, then .prd_loop/GOAL.md and .prd_loop/CHECKLIST.md in full, then
.prd_loop/PROGRESS.md for current status. Starting from the next Missing row, work
GOAL.md's plan-build-test cycle: actually run each row's tests and show real output, don't
just assert they pass. Commit locally once tests pass, but do NOT push yet. Then act as an
independent verifier on your own work — re-read the PRD text fresh and re-run the tests
again, skeptically, as if checking someone else's claim — before deciding pass or fail. Only
if that independent check passes should you update PROGRESS.md to Done and push; if it
doesn't pass, leave the row In Progress, note the gap, and do not push. After finishing a
row, automatically continue to the next Missing row without waiting for me to say
"continue" — only stop and ask if you hit an AGENTS.md Tier 2 situation. Run AGENTS.md's
pre-turn-end self-check and update PROGRESS.md after every row regardless of outcome.
```

If it stops and waits for you anyway (the unverified behavior flagged above), this gets it going
again without re-explaining everything:
```
Continue — re-read .prd_loop/PROGRESS.md for current status and keep working the next
Missing row per the same cycle, still without stopping between rows unless it's a genuine
AGENTS.md Tier 2 situation.
```

## Running it unattended via the CLI

A single `codex exec` call does one row (that's deliberate — GOAL.md's quality rule is one row per
turn). Repeatedly re-invoking Codex until the checklist is done needs an external driver since
Codex CLI has no native multi-turn loop either. That driver is
[`scripts/run-loop.sh`](scripts/run-loop.sh):

```bash
# one-time setup
npm install -g @openai/codex     # or: brew install --cask codex
codex                            # sign in with ChatGPT the first time

# then, from the repo root:
./scripts/run-loop.sh
```

What it does each iteration — three sub-steps, not two: a `--profile build` turn (build, actually
run tests, commit **locally only**), a `--profile verifier` turn (read-only, independently re-runs
the tests itself, states a plain PASS/BLOCK verdict — it cannot write files or push), then a second
`--profile build` turn that reads that verdict and either records `Done` + pushes (PASS) or records
`In Progress` + the specific gap and does **not** push (BLOCK). All three are logged to
`run-logs/` (gitignored). The point of this order: nothing reaches the shared remote until an
independent re-check has actually passed. The loop checks `.prd_loop/PROGRESS.md` for real
progress after each iteration and stops itself — not just runs forever — in three cases:
- **Done**: no rows left `Missing`/`In Progress`.
- **Stalled**: no row count change for `STALL_LIMIT` turns (default 3) — nearly always means
  something got logged under "Escalations to human" or "Open questions blocking progress" that
  needs your decision. The script prints that section directly so you don't have to go find it.
- **Safety cap**: `MAX_TURNS` reached (default 80, override with `MAX_TURNS=200 ./scripts/run-loop.sh`)
  — this is the turn-budget cap Codex CLI itself doesn't provide.

Safe to Ctrl+C and re-run any time — it picks up wherever `PROGRESS.md` says it left off. Run it in
a background terminal, `tmux`/`screen` session, or `nohup ./scripts/run-loop.sh &` if you want it
to survive closing your terminal; pair Codex Remote if you want to check on it or resolve a stall
from your phone instead of the machine itself.

A single-turn manual invocation still works too, if you'd rather step through by hand:

```
codex --profile build exec "Read AGENTS.md if you haven't already this session. Read
.prd_loop/GOAL.md and .prd_loop/CHECKLIST.md in full, then .prd_loop/PROGRESS.md for current
status. Work the next Missing row per GOAL.md's cycle, then update PROGRESS.md before finishing."
```

Verification pass for a row just marked Done:
```
codex --profile verifier exec "Re-read documentation/Chariot_PRD_v1.3.md for row N's requirement
IDs (see .prd_loop/CHECKLIST.md) and confirm the latest commit's diff + tests actually match the
PRD text. Report a pass/fail with specific citations, and log the result in PROGRESS.md."
```

## The per-turn cycle

For each row in `.prd_loop/PROGRESS.md`:
1. **Plan** — read the row's PRD sections/requirement IDs before writing code.
2. **Build** — implement exactly what those requirement IDs describe. Runs under `--profile build`
   (`workspace-write` + `approval_policy = never`), so command execution doesn't stop to ask
   permission — `AGENTS.md`'s Tier 2 list (design/product judgment calls) is the only thing that
   should pause a turn.
3. **Test** — write/run the Jest, Playwright, Artillery, or security tests §12 assigns to that row; must pass before moving on.
4. **Commit & push** — commit referencing the row number + requirement IDs, then push.
5. **Verify** — run the `verifier` profile pass (above) before the row is marked Done in `PROGRESS.md`.
6. Move to the next `Missing` row, respecting the dependency order in `CHECKLIST.md`.

Watch the first 2–3 turns to confirm Codex is actually updating `.prd_loop/PROGRESS.md`'s status
table and committing/pushing each turn — not just building silently and forgetting to log status.
That table (plus git history) is what tells the loop, and you, when it's actually done. If you've
paired Codex Remote, you can do this check-in from your phone instead of sitting at the machine.

Per-row verification only confirms the row just built. Row 45 (Phase 5) is a separate, independent
safety net: it re-greps the whole PRD for every requirement ID and confirms nothing was missed by
the checklist's own row-grouping. That grouping isn't infallible — while wiring this loop up I
initially mis-scoped one row and missed two whole requirement categories (`MC-` and `NFR-`) until a
manual audit caught it. Row 45 is what catches that class of drift automatically going forward, so
"every row above is Done" is never treated as sufficient on its own.

Row 00 (Telnyx Toll-Free Verification) is a human action Codex cannot perform — it's logged as a
standing escalation in `PROGRESS.md` from turn one and does not block any other row except the
Phase 6 pilot launch.

Escalations and open questions Codex can't resolve on its own are logged directly in
`.prd_loop/PROGRESS.md` under "Open questions blocking progress" and "Escalations to human," per
`AGENTS.md`'s "How to ask" rules.
