# Chariot — Autonomous Build Loop

This repo drives an autonomous Codex loop that **builds** the Chariot ride-coordination system
against an already-finished PRD. Codex does not write the PRD — it reads it as a fixed spec and
implements the software, one checklist row at a time, with a `plan → build → test → commit → push`
cycle per row.

| Path | Purpose |
|---|---|
| [`documentation/Chariot_PRD_v1.3.md`](documentation/Chariot_PRD_v1.3.md) | The finished PRD — sole source of requirements. Codex reads from this; it does not edit it. |
| [`.prd_loop/GOAL.md`](.prd_loop/GOAL.md) | The durable objective, the per-turn plan/build/test/commit/push cycle, and working rules. |
| [`.prd_loop/CHECKLIST.md`](.prd_loop/CHECKLIST.md) | The dependency-ordered build checklist (49 rows, Phase 0–7), each row mapped to exact PRD requirement IDs, plus a final full-coverage cross-check row (45). |
| [`.prd_loop/PROGRESS.md`](.prd_loop/PROGRESS.md) | Status table Codex updates every turn — the mechanism that tracks what's Done/Missing/Skipped and drives the next row picked. |
| [`.codex/config.toml`](.codex/config.toml) | The read-only `verifier` profile (checks built code + tests against the PRD before a row is marked Done) and the `rollout_budget` cap. |

Because these files live under `.prd_loop/` rather than repo root, Codex won't discover them by
default root-first scanning — point it at them explicitly when starting the loop:

```
codex/goal Read .prd_loop/GOAL.md and .prd_loop/CHECKLIST.md, then work through
.prd_loop/PROGRESS.md until every applicable row is Done or Skipped/N/A. Read
documentation/Chariot_PRD_v1.3.md as the fixed spec — do not modify it.
```

## The per-turn cycle

For each row in `.prd_loop/PROGRESS.md`:
1. **Plan** — read the row's PRD sections/requirement IDs before writing code.
2. **Build** — implement exactly what those requirement IDs describe.
3. **Test** — write/run the Jest, Playwright, Artillery, or security tests §12 assigns to that row; must pass before moving on.
4. **Commit & push** — commit referencing the row number + requirement IDs, then push.
5. **Verify** — the read-only verifier profile re-reads the actual PRD text for that row's
   requirement IDs (not the checklist's paraphrase) and confirms the diff + tests match it,
   line-by-line, before the row is marked Done in `PROGRESS.md`.
6. Move to the next `Missing` row, respecting the dependency order in `CHECKLIST.md`.

Watch the first 2–3 turns to confirm Codex is actually updating `.prd_loop/PROGRESS.md`'s status
table and committing/pushing each turn — not just building silently and forgetting to log status.
That table (plus git history) is what tells the loop, and you, when it's actually done.

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
`.prd_loop/PROGRESS.md` under "Open questions blocking progress" and "Escalations to human."
