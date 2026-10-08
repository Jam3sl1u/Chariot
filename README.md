# Chariot — Church Rides MVP

Chariot coordinates weekly church rides for multiple churches that share one Discord guild and one
Google Sheet. This repo is the **Discord + Google Sheets MVP** defined in PRD §29
([`documentation/prd/Chariot_PRD_v2_3.md`](documentation/prd/Chariot_PRD_v2_3.md)) — the lightweight
phase that precedes the full platform in PRD §1–28.

- **Discord bot** (Node.js / discord.js) — registration survey, ride requests by reaction, driver
  YES/NO availability, admin `/rides` commands.
- **Google Sheet** — the data store for every church; each data tab carries a `churchId`.
- **Apps Script** ([`apps-script/Code.gs`](apps-script/Code.gs)) — the Saturday assignment run, once
  per church.

Setup, configuration and the exact manual acceptance test live in
[`docs/discord-bot.md`](docs/discord-bot.md). Quick start: `npm ci`, configure `.env`,
`npm run setup:sheets`, then `npm start`.

## Repo layout

| Path | Purpose |
|---|---|
| [`src/`](src/) | Bot: Discord handlers (`bot.ts`), business logic (`service.ts`), Sheets access (`sheets.ts`), assignment function (`assignment.ts`), zones, time, config. |
| [`apps-script/`](apps-script/) | `Code.gs` (assignment run, trigger, sheet buttons, E2E tests) and `Reports.gs`. |
| [`scripts/`](scripts/) | Sheet verification plus seed/migrate/verify helpers for zones, routing data and assignment tests. |
| [`tests/`](tests/) | `node --test` suites using in-memory Sheets and Discord doubles. |
| [`docs/discord-bot.md`](docs/discord-bot.md) | Install, supporting columns, timing/recovery, manual acceptance test. |
| [`documentation/`](documentation/) | The PRD (read-only spec) and the pilot church's pickup-point seed data. |
| [`AGENTS.md`](AGENTS.md) | Working agreement for AI coding agents: when to proceed vs. stop and ask. |

## Commands

| Command | What it does |
|---|---|
| `npm start` | Runs the bot as one persistent process. |
| `npm run setup:sheets` | Appends the approved supporting headers to the existing tabs and creates the `Broadcasts` tab if missing (bot stopped). |
| `npm run verify:sheets` | Checks API access and headers without printing IDs or data. |
| `npm run migrate:zones-global` / `seed:priority-zones` / `seed:routing-data` | One-time zone and routing-data setup. |
| `npm run seed:assignment-test` / `verify:assignment-test` | Seed and check two-church assignment test data. |
| `npm run typecheck` / `npm test` | Static checks and automated tests (no live Discord or Sheet access). |

## MVP requirement status (PRD §29.6)

Status reflects the code on `main`. "Not built" means no code exists for it yet.

| ID | Requirement (short) | Status | Where |
|---|---|---|---|
| MVP-000 | Resolve `(guild, channel, message)` → one `churchId` via `activeMessageId`; drop unknown/ambiguous | Done | `src/service.ts`, `src/bot.ts` |
| MVP-001 | Unregistered reactor gets a **Start registration** DM; no rows until survey completes; registration reusable across churches | Done | `src/service.ts`, `src/bot.ts` |
| MVP-002 | Any emoji reaction add/remove creates/cancels a `RideRequests` row for that church and week | Done | `src/service.ts` |
| MVP-003 | +1/guest flow | Deferred (PRD: decide later) | — |
| MVP-004 | Driver YES/NO reply sets `isAvailableThisWeek` for that driver's church | Done | `src/service.ts`, `src/bot.ts` |
| MVP-005 | Saturday Apps Script loops `Churches` and assigns riders to drivers per church, never mixing churches | Done in Apps Script, not yet verified against live data. The matching prefers same housing, then seeded distance, then zone priority, which goes beyond §29's "fixed zone-priority" wording. | `apps-script/Code.gs`, `src/assignment.ts` |
| MVP-006 | Unseated riders written with blank `driverId` and an `unassignedReason` | Done | `apps-script/Code.gs` |
| MVP-007 | Bot-side trigger DMs drivers and members their results and sets `notified = true` | **Not built.** The `notified` column exists, but no bot code reads it. | — |
| MVP-008 | Apps Script holds a script lock for its run | Done | `apps-script/Code.gs` (`LockService`) |
| MVP-009 | Clear active-post and availability state on every process start; no automatic scheduled work | Partly. The no-scheduling half holds (the timer is never started). Commit `e9a7d1f` deliberately stopped clearing state on startup, so the PRD text and `docs/discord-bot.md` no longer match the code. | `src/bot.ts` |

## MVP build tasks (PRD §29.9)

| # | Task | Status |
|---|---|---|
| M.1 | Sheet with six tabs, service account, bot invited | Done (setup and verify scripts) |
| M.2 | Message-ID → church resolution and the reaction-initiated survey | Done |
| M.3 | Driver ask and reply handling against the Sheet | Done |
| M.4 | Assignment as a pure function, with edge-case tests | Done (`tests/assignment.test.ts`) |
| M.5 | Apps Script port, Saturday trigger, lock | Done; run the manual two-church check before relying on the trigger |
| M.6 | Bot sends assignment DMs and marks `notified` | **Not built** (MVP-007) |
| M.7 | Full dry-run week with seeded data for both churches | Not done |
| M.8 | Pilot launch with both real churches | Not done |

## Added beyond PRD §29

- **Broadcasts:** `/rides broadcast name:<id>` posts a greeting and then one ride post (or driver
  ask) per listed church, from a row in the `Broadcasts` tab. Re-running replaces the previous
  block. See [docs/discord-bot.md](docs/discord-bot.md#broadcasts-one-command-for-a-greeting-plus-every-churchs-message).

- **Driver sign-up by reaction:** reacting to a driver ask now works like a ride reaction. Unregistered
  people and registered riders are walked through a short sign-up, people who already drive for another
  church are added automatically, and only a reaction ever makes a driver available. A reaction by a
  non-driver creates a placeholder `Drivers` row (`signupStatus` PENDING, 4 seats) that sign-up completes, and
  `Members.canDrive` flags who can drive. `/rides sync` also catches up driver reactions. Run
  `npm run setup:sheets` before deploying, to add the two new columns. See [docs/discord-bot.md](docs/discord-bot.md#driver-reactions-and-sign-up).

## Not in the MVP (PRD §29.4)

Web app and member portal, Postgres/Prisma, SMS, +1 guests, standing rides, waitlist autofill,
detour-cost routing, Calendar sync, and self-service church onboarding. See the PRD for the full
build these move to once the MVP graduation criteria (PRD §29.10) are met.

## Open items

- **Assignment notifications (MVP-007 / M.6):** the main functional gap before a full
  ask → assign → notify week can run.
- **Wording mismatch:** the PRD describes assignment as fixed zone-priority grouping, while the code
  adds same-housing and distance preferences. Decide whether to update the PRD or simplify the code.
- **Dry run and pilot (M.7, M.8):** follow the manual acceptance test in
  [`docs/discord-bot.md`](docs/discord-bot.md).
