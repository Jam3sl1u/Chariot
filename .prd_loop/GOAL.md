# GOAL: Build Chariot per its PRD

## Objective
Implement the Chariot ride-coordination system exactly as specified in
[`documentation/Chariot_PRD_v1.3.md`](../documentation/Chariot_PRD_v1.3.md) ("the PRD").

**The PRD is a finished, fixed input — not something Codex writes or edits.** It is already complete
(50/50 on the completeness standard) and is the sole source of requirements. Codex's job is to
build the actual software (schema, bot, web app, algorithm, tests, infra) that satisfies it, one
checklist row at a time, until nothing is left unbuilt.

Codex: treat this as a durable goal. Keep iterating across turns until the definition of done below
is met. Do not declare the goal complete based on your own judgment alone — completion must be
confirmed by the read-only verifier profile (`[profiles.verifier]` in `../.codex/config.toml`,
invoked via `codex --profile verifier`) against `CHECKLIST.md` and reflected in `PROGRESS.md`.

**Before anything else, read `../AGENTS.md`** (Codex reads it automatically at session start, but
its rules are load-bearing enough to restate here) — it defines exactly when you should proceed
without asking versus stop and get human confirmation. This file assumes you already know that
distinction; it does not repeat it.

## The per-turn cycle

Every turn works exactly one row (or a tightly-coupled small group of rows) from `PROGRESS.md`, in
this fixed sequence:

1. **Plan** — read `PROGRESS.md` to find the next `Missing` row in dependency order (top to bottom;
   respect the Depends-on notes in `CHECKLIST.md`). Open the PRD itself and read the literal text of
   every requirement ID that row lists — `CHECKLIST.md`'s one-line summary is a derived index and
   can be wrong or incomplete (it already was once; see the note at the top of `CHECKLIST.md`), so
   treat the PRD as the actual source and the checklist row as a pointer to it, not a substitute for
   reading it. State what you're about to build, quoting or closely paraphrasing the specific PRD
   requirement text (not the checklist's summary) for each ID, before writing any code.
2. **Build** — implement the row's requirement IDs in the actual codebase (create the monorepo
   structure described in the PRD's §2.1/2.4 if it doesn't exist yet). Match the PRD's stated
   stack, schema, routes, and behavior exactly — do not substitute a different design because it
   seems easier, and do not silently narrow scope.
3. **Test** — write and *actually execute* the test coverage the PRD's §12 assigns to this row's
   Test IDs (Jest unit/integration, Playwright E2E, Artillery load, or security tests, as
   applicable). Run the real command and show its real output (pass/fail counts) — do not assert
   "tests pass" without having run them in this turn. All tests for this row must pass locally
   before moving on. A row is not buildable-complete without its tests — "build" and "test" are one
   step, not two rows. See `../AGENTS.md`'s mandatory self-check before ending the turn.
4. **Commit & push** — commit the row's changes with a message referencing the row number and
   requirement IDs (e.g. `Row 07: detour-cost algorithm core (BE-001–BE-024)`), then push. If the
   repo has CI wired up (row 42) and branch protection on `main`, push a branch and open a PR so CI
   gates the merge; until then, commit directly to `main` — this is a solo-developer repo (PRD
   §1.4) with no external approval chain. This step runs under `codex --profile build`
   (`sandbox_mode = "workspace-write"`, `approval_policy = "never"` — see `../.codex/config.toml`),
   so it should not stop to ask permission for the command itself; `AGENTS.md`'s Tier 2 list is
   about product/design judgment calls, not command execution.
5. **Update PROGRESS.md** — set the row's status, verifier-check result, and a one-line note;
   append a Turn log line with the commit SHA. Do this in the same turn as the commit, not deferred.
6. **Move to the next Missing row.**

## Verification

Every row moved to `Done` in a given turn must first be checked by the read-only verifier profile.
The verifier's job: **independently re-read the actual PRD text** for that row's requirement IDs
(not `CHECKLIST.md`'s paraphrase — go back to `documentation/Chariot_PRD_v1.3.md` itself), **re-run
the row's actual test command itself** (don't just read the build turn's claimed output — its
`sandbox_mode = "read-only"` still permits executing a test command; `approval_policy = "untrusted"`
means it will prompt before doing so, which is expected, not a failure), and confirm the diff and
the real test output match the PRD line-by-line — it does not write or fix code, only approves or
blocks with a specific reason (e.g. "BE-018 requires the *larger* of percent/flat tolerance; the
diff only checks percent" or "claimed tests pass, but re-running `npm test -- assign` shows 2
failures"). Record that specific citation in `PROGRESS.md`'s Verifier check column (which PRD
requirement, which file/line it maps to, the actual test command and result it independently
observed) — not just a checkmark, since an unspecific "✓" gives no way to audit the check later. If
it blocks, the row stays `In Progress`, the specific gap goes in the row's Note column, and the same
row is retried next turn — do not move on with a known mismatch.

This per-row check only confirms the one row just built. It does not, by itself, guarantee nothing
upstream regressed or that the checklist's own row-grouping covered every requirement in the PRD —
that's what row 45's full requirement-ID cross-check (Phase 5) exists to catch independently before
launch.

## Definition of done

For every row in `CHECKLIST.md`, its status in `PROGRESS.md` must be one of:
- **Done** — every requirement ID the row lists is implemented, its Test IDs pass, and the verifier
  has confirmed the match.
- **Skipped** — intentionally deferred by a documented decision, with rationale recorded. Per
  working rule 6 below, load-bearing rows (schema, algorithm, security, tenant isolation) must not
  be Skipped without human confirmation first.
- **N/A** — does not apply. There are no Conditional rows in this build checklist as currently
  scoped; if a future PRD revision removes scope, mark the corresponding row N/A with a one-line
  reason pointing at the PRD's Document Change Log entry that removed it.

The goal is NOT complete while any row is still **Missing** or **In Progress**, and it is not
complete until row 45 (the full requirement-ID cross-check) and Phase 7 (row 48, multi-church
rollout) are both Done.

## Working rules

1. Read `PROGRESS.md` at the start of every turn to see current state before acting — do not
   restart from scratch or re-plan rows already marked Done.
2. Work on ONE row (or a tightly related small group explicitly noted as such in `CHECKLIST.md`,
   e.g. rows sharing a "Depends on row X" chain that only makes sense built together) per turn.
   Do not try to build multiple independent phases in a single pass — this is how quality degrades
   and how context gets overloaded.
3. Never invent PRD content. If a row's behavior is genuinely ambiguous even after reading the
   relevant PRD section and its Open Decisions Log (§23) entry, log the ambiguity in the "Open
   questions blocking progress" section of `PROGRESS.md` against that row's number, and leave the
   row `In Progress` or `Missing` — it does not get marked Done on an assumption. This should be
   rare: the PRD was written specifically so Codex "can build on its own fully" (§23 decision log,
   2026-07-21 entry on third-party integration specs) — most rows should not need this escalation.
4. Follow the dependency order in `CHECKLIST.md`. Do not start a row whose Depends-on rows aren't
   Done yet, even if it looks quick.
5. Row 00 (Telnyx Toll-Free Verification) is a human action, not a code task — it cannot be done
   from the repo. Log it as an escalation on turn 1 and do not let it block any other row; only
   Phase 6 (pilot launch) actually depends on it being approved.
6. **When to stop and ask a human is defined in `../AGENTS.md` (Tier 2), not restated here** — that
   file is the single source of truth for the approval gate so it can't drift out of sync with this
   one. In short: schema/algorithm/security/tenant-isolation Skips, repeated verifier blocks on the
   same ID, unresolved design forks, and row 45 finding a real gap all require a stop. Row 45 itself
   must never be marked Skipped. There is no native turn/token budget to watch for (verified — see
   `AGENTS.md`'s note); check progress periodically instead of relying on a budget signal to stop.
