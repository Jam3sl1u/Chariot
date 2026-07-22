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
on a given turn explicitly:

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
