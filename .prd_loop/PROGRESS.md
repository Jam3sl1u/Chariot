# Chariot Build Loop Progress Log

Last updated: 2026-09-24 (America/Los_Angeles)
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

- None for the requested MVP implementation. User approved adding the supporting
  columns omitted from §29.5 (timezone/schedule/message context, phone/preferences,
  guest phone, and durable per-week prompt state). See `docs/discord-bot.md`.

## Scoped MVP request — M.2 / M.3

- Status: **In Progress — implementation and build tests passed; verifier profile cannot start**.
  This is the user's explicitly requested MVP-000–004 task, not a start of the
  unrelated full-platform checklist. Full-platform rows above remain unchanged.
- MVP-000: `src/service.ts:17` (`resolve`, `run`, `patch`) resolves every mutation's
  guild via Churches, rejects unknown/ambiguous mappings and tags writes with churchId.
  `src/bot.ts:187` (`message`) routes DMs only through saved, user-bound prompt context.
- MVP-001 / BOT-001–009 as adapted by §29: `src/bot.ts` registration modal, live
  church-scoped Zones dropdown and Discord-only preference; `src/service.ts`
  `register` (`src/service.ts:50`) upserts by churchId + discordId and validates US E.164 phones.
- MVP-002/003 / BOT-010–021: weekly post/scheduling/recovery, ✅ cancellation/re-add,
  guest name/phone/update/removal, persisted prompt IDs, startup and `/rides sync`
  reconciliation in `src/bot.ts:219`, `src/bot.ts:241`, `src/service.ts:67`, `src/time.ts`.
- MVP-004 / BOT-022–030 as adapted by §29 and the user's algorithm exclusion:
  church-local Thursday asks, weekly reset, exact YES/NO parsing, scoped availability
  updates (`src/service.ts:97`), nonresponder resends and manual Sheet overrides. Late YES records availability
  and directs the driver to an admin; no assignment/autofill is invoked.
- Credentials: `.env.example` has exactly the three requested keys blank;
  `src/config.ts` and `src/sheets.ts` load them. Key and environment files are ignored.
  `src/setup.ts` adds approved headers to existing tabs; no Assignments/Apps Script changes.
- `assignmentCompletedWeek` is an explicit future integration/admin marker, avoiding a
  fabricated clock-only assignment completion. Its use is documented; bot never sets it.
- Actual build validation: `node node_modules/typescript/bin/tsc --noEmit` exited 0
  (no diagnostics); `node node_modules/tsx/dist/cli.mjs --test tests/*.test.ts`:
  **tests 20, pass 20, fail 0, skipped 0**. Google client upgrade install audit:
  **found 0 vulnerabilities**. Tests use doubles, not live credentials.
- Live manual testing remains required: `.env` and `service-account-key.json` were
  absent in this checkout. Exact steps: `docs/discord-bot.md`, “Exact manual acceptance test”.
- No push authorized/requested here. Stop after this scoped implementation and local commit.
- Implementation commit: `0781088`. Attempted independent verification using
  `codex --profile verifier -a never exec --ephemeral ...`; the CLI refused to start
  with **`Error: approval_policy = "untrusted" is no longer supported; remove this setting`**.
  The saved user verifier profile contains that legacy setting, and the command-line
  override did not bypass its validation. No verifier model ran or executed tests,
  so there is no PASS/BLOCK verdict. Did not edit James's global profile; did not push.

## Turn log
*(Codex: append one line per turn — turn #, row(s) touched, outcome, commit SHA)*

- Turn 1: Workflow setup — installed the stable Codex CLI launcher, migrated build/verifier profiles to user-scoped profile files, and corrected the runner’s Row 00 handling and verifier-before-push documentation. No checklist row was started; no commit or push was made.
- Turn 2 (2026-09-24): M.2/M.3 scoped implementation, MVP-000–004; user approved supporting
  schema columns. Build tests: 20 passed, 0 failed; typecheck exit 0. Local implementation
  commit `0781088`; independent verifier failed to start due to unsupported legacy
  `untrusted` approval policy in the saved profile. Recorded status In Progress;
  no verifier PASS claimed. No push or algorithm work. Final log-only commit records this outcome.

## Escalations to human
*(Codex: log anything you surfaced for remote approval/decision, and the outcome once resolved)*

- M.2/M.3 schema mismatch (AGENTS.md Tier 2): Section 29.5 omits state required by
  Section 4. Asked whether to add the needed columns; James answered “Add the required
  columns (recommended)” in this turn. Resolved; no blocking product question remains.
- M.2/M.3 verification: saved `~/.codex/verifier.config.toml` uses an approval policy
  the installed CLI no longer supports. The independent verifier cannot start until
  that profile is migrated. Build code is committed and 20 tests pass; live checks
  and a genuine independent verifier run remain outstanding.

- Row 00 (Telnyx Toll-Free Verification): this is a real-world business verification submitted
  through Telnyx's portal, not something Codex can do from the repo. Flagged immediately per
  GOAL.md working rule — needs James to submit this on day one; 4–8 week approval lead time is the
  single biggest schedule risk in the PRD (§19, Risk #1).
