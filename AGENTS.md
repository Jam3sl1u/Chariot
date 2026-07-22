# Chariot — Codex working agreement

Codex reads this file automatically at the start of every session in this repo — you don't need to
be told to read it. It governs one thing above all else: **when to just proceed, and when to stop
and ask a human.** Everything else about the build (the objective, the per-turn cycle, the checklist)
lives in `.prd_loop/` and `documentation/` — read those too, but this file is what decides whether
you need James in the loop for a given action.

## The two tiers

### Tier 1 — proceed without asking

This covers the large majority of work:
- Any `.prd_loop/CHECKLIST.md` row whose requirement IDs and PRD text (`documentation/Chariot_PRD_v1.3.md`)
  fully specify the behavior — build it, test it, commit it, push it, update `PROGRESS.md`. No
  check-in needed.
- Routine implementation choices *within* what the PRD already specifies — file layout inside the
  given monorepo structure, variable/function naming, which utility to extract, how to structure a
  test file. These don't change product behavior, so they're yours to decide.
- Retrying a row after a verifier block, on the first attempt.
- Anything reversible and contained to this repo (edits, commits on a branch, local test runs).

### Tier 2 — stop and ask before proceeding

Ask when any of these are true. Don't guess, don't pick the option that seems most likely, and don't
mark the row Done while the question is open:

1. **The PRD is genuinely ambiguous or silent** on a real product decision, even after reading the
   relevant section and its Open Decisions Log (§23) entry. (This should be rare — the PRD was
   written specifically to avoid this.)
2. **A design/architecture fork with no PRD-specified answer** — the row can be built in more than
   one materially different way (different library, different data flow, different UX behavior) and
   the choice isn't just an implementation detail, it's a real decision someone should sign off on.
3. **You're about to mark a row `Skipped`** and it touches schema, the assignment algorithm, tenant
   isolation, or security (`.prd_loop/CHECKLIST.md` rows 03, 04, 07, 37, 41, 44). These skips always
   need human confirmation.
4. **The same open question has blocked a row for 2+ turns.**
5. **The verifier blocks the same requirement ID twice in a row** — that usually means the row's
   design needs to change, not just the code; don't try a third variation unprompted.
6. **Row 45's full requirement-ID cross-check finds a gap** no earlier row covered.
7. Anything that would require a real-world account, purchase, credential, or business action you
   can't perform yourself anyway (Telnyx verification, buying a domain, etc.) — log it, don't stall
   on it, see "How to ask" below.

## How to ask

There's no special approval-gate feature for this — it's just judgment, surfaced plainly:

1. **State the question directly in your turn's output**, specific enough to answer in one line —
   not "how should I handle pickup points?" but "the PRD doesn't specify X; should I do A or B, and
   why does it matter?" If James has Codex Remote paired to this machine, this is what shows up on
   his phone for review/approval.
2. **Log it in `.prd_loop/PROGRESS.md`** under "Open questions blocking progress" (with the row
   number it blocks) or "Escalations to human" (for the Tier 2 categories above) — in the same turn,
   not deferred. This is what makes the question durable even if no one's watching live.
3. **Don't stall the whole session on one blocked row.** Check `.prd_loop/CHECKLIST.md`'s dependency
   order — if another `Missing` row doesn't depend on the blocked decision, work that one instead
   while the question is open. Only genuinely idle if every remaining row transitively depends on
   the answer.

## Command-level autonomy (separate from the above)

The two tiers above are about product/design judgment calls — a different thing from whether Codex
prompts before running a shell command. That's governed by `.codex/config.toml`'s `approval_policy`
and `sandbox_mode`, set to allow full autonomy *within this repo* (`workspace-write` + `never`) so
routine build/test/commit/push work never stops to ask permission for the command itself. Use
`codex --profile build` for normal build turns. Use `codex --profile verifier` — read-only, always
prompts (`untrusted`) — for the verification pass GOAL.md's per-row cycle requires.

**No native spending or turn cap exists in Codex CLI** (verified against the official docs — there's
no `rollout_budget` or equivalent). "Runs without me otherwise" means unattended in the
approval-prompt sense, not unattended in the never-check-on-it sense — check progress periodically
via `.prd_loop/PROGRESS.md`'s Turn log, or via Codex Remote if paired.
