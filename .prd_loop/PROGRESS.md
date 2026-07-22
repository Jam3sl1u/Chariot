# Chariot Build Loop Progress Log

Last updated: *(Codex: update this timestamp every turn)*
Overall status: **NOT COMPLETE** — flip to **COMPLETE** only when every applicable row below is
Done or Skipped/N/A with rationale, the verifier has signed off on each, row 45's full
requirement-ID cross-check has passed, and Phase 7 (row 48) is Done.

## Status table
Status values: `Missing` | `In Progress` | `Done` | `Skipped` | `N/A`

Per-turn cycle for whichever row is picked: **plan → build → test → commit → push → next row.**
See `GOAL.md` for the full definition of each step. Do not mark a row Done until its tests have
actually been *executed* (not just written) and the verifier profile has independently re-run them
itself, re-read the cited PRD requirement IDs (not just this table's paraphrase), and confirmed the
diff matches. The **Verifier check** column should record specifics (e.g. "✓ BE-016–019 @
assign.ts:40-95, re-ran `npm test -- assign`: 12/12 pass"), not just a checkmark — that citation,
including the actual test command and result the verifier itself observed, is what makes the check
auditable later instead of self-reported. See `../AGENTS.md`'s mandatory pre-turn-end self-check.

| # | Phase | Build item | Status | Verifier check | Note / rationale |
|---|---|---|---|---|---|
| 00 | 0 | Submit Telnyx Toll-Free Verification | Missing | — | Human action — see Escalations below |
| 01 | 0 | Monorepo scaffold | Missing | — | |
| 02 | 0 | Neon + Prisma bootstrap + base NextAuth shell | Missing | — | |
| 03 | 1 | Full Prisma schema (all models, §2.3) + MC-001/004/006 | Missing | — | |
| 04 | 1 | Tenant isolation Prisma middleware (MC-002/007/008) | Missing | — | |
| 05 | 1 | Nominatim geocoding + geo-tz | Missing | — | |
| 06 | 1 | Local haversine distance computation + seed pilot registry from provided dataset | Missing | — | |
| 07 | 1 | Detour-cost assignment algorithm core | Missing | — | |
| 08 | 1 | Algorithm regression-snapshot harness + CI gate | Missing | — | |
| 09 | 2 | Bot process scaffold + per-minute master cron (MC-003) | Missing | — | |
| 10 | 2 | `/register` slash command flow | Missing | — | |
| 11 | 2 | Web signup flow | Missing | — | |
| 12 | 2 | Weekly ride post + reactions | Missing | — | |
| 13 | 2 | Driver availability ask (YES/NO) | Missing | — | |
| 14 | 2 | Standing ride request auto-renewal job | Missing | — | |
| 15 | 2 | Scheduled jobs (reset/post/ask/remind/assign/notify) | Missing | — | |
| 16 | 2 | Telnyx SMS integration (outbound + inbound webhook) | Missing | — | |
| 17 | 2 | Notification channel-selection + fan-out | Missing | — | |
| 18 | 2 | Bot-offline mitigations (reconciliation, /rides sync, health) | Missing | — | |
| 19 | 2 | `/rides ...` Discord command reference | Missing | — | |
| 20 | 3 | Auth (login, first-login, forgot-password, sessions) | Missing | — | |
| 21 | 3 | Member portal — groups, ride status, +1, cancellation | Missing | — | |
| 22 | 3 | Standing requests + ride history (portal) | Missing | — | |
| 23 | 3 | Member profile + Calendar connect entry point | Missing | — | |
| 24 | 3 | Special requests — member side | Missing | — | |
| 25 | 3 | Admin dashboard overview + This Week management | Missing | — | |
| 26 | 3 | Waitlist auto-fill + reassignment notice | Missing | — | |
| 27 | 3 | Admin member management | Missing | — | |
| 28 | 3 | Admin driver management | Missing | — | |
| 29 | 3 | Admin special request inbox | Missing | — | |
| 30 | 3 | Admin stats & history | Missing | — | |
| 31 | 3 | Church settings + onboarding + PickupPoint registry mgmt (MC-005) | Missing | — | |
| 32 | 3 | Admin assignment (super-admin only) | Missing | — | |
| 33 | 3 | Full API route surface cross-check | Missing | — | |
| 34 | 3 | Key screens per wireframe descriptions | Missing | — | |
| 35 | 4 | Google Calendar OAuth flow | Missing | — | |
| 36 | 4 | Calendar event create/update/delete lifecycle | Missing | — | |
| 37 | 4 | Refresh-token encryption at rest | Missing | — | |
| 38 | 5 | Remaining Jest unit/integration coverage | Missing | — | |
| 39 | 5 | Full Playwright E2E suite | Missing | — | |
| 40 | 5 | Load testing (Artillery) + NFR-001/002/004 | Missing | — | |
| 41 | 5 | Security testing pass | Missing | — | |
| 42 | 5 | CI/CD pipeline (GitHub Actions) | Missing | — | |
| 43 | 5 | Monitoring & observability + NFR-003 (uptime) | Missing | — | |
| 44 | 5 | Data security & compliance pass | Missing | — | |
| 45 | 5 | **Full requirement-ID cross-check across entire PRD** | Missing | — | Independent backstop — see CHECKLIST.md |
| 46 | 6 | Onboard pilot church | Missing | — | |
| 47 | 6 | Parallel-run week vs. spreadsheet, then retire it | Missing | — | |
| 48 | 7 | Onboard remaining churches | Missing | — | |

## Open questions blocking progress
*(Codex: log anything you can't resolve yourself here, with which row # it blocks)*

- 

## Turn log
*(Codex: append one line per turn — turn #, row(s) touched, outcome, commit SHA)*

- Turn 1: —

## Escalations to human
*(Codex: log anything you surfaced for remote approval/decision, and the outcome once resolved)*

- Row 00 (Telnyx Toll-Free Verification): this is a real-world business verification submitted
  through Telnyx's portal, not something Codex can do from the repo. Flagged immediately per
  GOAL.md working rule — needs James to submit this on day one; 4–8 week approval lead time is the
  single biggest schedule risk in the PRD (§19, Risk #1).
