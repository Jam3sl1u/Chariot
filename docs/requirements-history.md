# Requirement history

This is the status of PRD §29, reviewed against the code in this repository. The PRD itself stays at [`documentation/prd/Chariot_PRD_v2_3.md`](../documentation/prd/Chariot_PRD_v2_3.md). Setup and the manual acceptance test stay in [`discord-bot.md`](discord-bot.md).

The words below mean:

- **Works today:** the behavior is in the current code and is covered by the automated tests. Those tests use in-memory Sheet and Discord doubles. They do not prove a live guild or a live Sheet.
- **Partial:** some of the behavior is implemented, and a named piece is missing, unwired, or only described as a manual check with no result recorded in this repository.
- **Superseded:** a later decision replaced the requirement, and that decision is in the code.
- **Planned:** the repository does not do this yet.

Nothing here is marked complete only because an older README said so. The "Earlier README" column is the label that used to sit in the README, kept so that history is not dropped.

## MVP requirements (PRD §29.6)

| ID | Requirement (short) | Earlier README | Reviewed status | Evidence |
|---|---|---|---|---|
| MVP-000 | Resolve one weekly post to one `churchId`. Drop unknown or ambiguous messages. | Done | Works today | `Service.resolveMessage` keeps a row only when exactly one church has that `activeMessageId`. `unique` logs and drops every other case. Tests: "unknown and ambiguous guild mappings never write", "churches sharing a guild and channel are isolated by active message". |
| MVP-001 | One registration form, opened from a Register button or from a DM. Reusable across churches. The PRD text says the first reaction writes neither a member nor a ride request, and that phone is E.164. | Done, awaiting the manual acceptance test | Partial | The form, the shared profile, the button, and the DM exist. Tests cover "an unregistered reaction starts one shared survey, creates a pending profile, and requests a ride" and "one registration is reused when the member requests a ride from another church". The first reaction does write a PENDING `Members` row and a `RideRequests` row. Phone only has to be non-empty. [`discord-bot.md`](discord-bot.md) records both as approved deviations. The manual acceptance test is written. This repository does not record that anyone has run it. |
| MVP-002 | Any emoji reaction adds or cancels that church's ride request for the week. | Done | Works today | `Service.reaction` writes one PENDING or CANCELLED row for the active post and week. A second reaction reuses the same request. Test: "any reaction creates one ride request; removal and re-add reuse it". |
| MVP-003 | +1 / guest flow. | Deferred (PRD: decide later) | Planned | The PRD marks this decide-later. New requests store `hasPlusOne` as false. The planner can reserve two seats if that flag is already true, and a test covers that, but no Discord flow collects a guest. Test: "a former +1 emoji is an ordinary ride signup". |
| MVP-004 | A driver's YES or NO reply sets `isAvailableThisWeek` for that church. | Done | Superseded | Availability is set by a reaction on that church's current driver ask, including removal. Tests cover the reaction path in `tests/driver-signup.test.ts` and `tests/bot.test.ts`. `driverReply` still parses a strict YES or NO, and the DM handler can call it, but current ask, reset, and sign-up code writes `askedWeek` and `askMessageId` as empty. A new ask therefore has no prompt id for that reply to match. No test calls `driverReply`. |
| MVP-005 | Saturday Apps Script assigns riders to drivers per church, by that church's fixed zone priority, and never mixes churches. | Done in Apps Script, not yet verified against live data | Partial | `runSaturdayAssignments` loops `Churches`, takes a script lock, and plans each church on its own. Both the TypeScript function and the Apps Script port ignore rows from other churches. The sort is not zone priority alone: same housing first, then seeded distance (haversine only as a fallback), then zone priority, then request id, then driver id. A re-run keeps riders who are already seated. `tests/assignment.test.ts` covers the TypeScript function. `runAssignmentE2eTests` in `apps-script/Code.gs` is not part of `npm test`. The manual two-church Sheet check is described and not recorded as done. |
| MVP-006 | Unseated riders are written with a blank `driverId` and an `unassignedReason`. | Done | Works today | Both planners do this. Reasons in code: "No available driver seats in this church." and "Pickup location needs completion or manual placement." Tests: "no drivers available leaves every rider unassigned with a reason", "more riders than total seats assigns by zone priority and records overflow". |
| MVP-007 | After assignment, the bot DMs drivers and members and sets `notified` true. | Not built | Planned | The `Assignments.notified` column exists. The Apps Script writes `notified: false` on new and updated rows. `scripts/verify-assignment-test.ts` asserts that rows stay unnotified. No bot code reads `notified` or sends an assignment DM. |
| MVP-008 | Apps Script holds a script lock for its run. | Done | Works today | `runAssignmentsAt_` and `resetAssignmentsAt_` call `LockService.getScriptLock`, wait up to 30 seconds, and release in `finally`. This is not executed by `npm test`. The lock does not cover writes the bot makes through the Sheets API. [`discord-bot.md`](discord-bot.md) says that explicitly. |
| MVP-009 | On every process start, clear the active post and availability state. Do no scheduled work. | Superseded | Superseded | Startup leaves `activeMessageId`, `activeWeekDate`, and `availabilityResetWeek` in place. Test: "startup preserves weekly post and availability-reset state, then waits for admin commands". A one-minute scheduler runs jobs from the `Schedules` tab. A church with no enabled row is left alone. Test: "with no enabled Schedules rows a tick changes no church or driver state". |

## Build tasks (PRD §29.9)

| # | Task | Earlier README | Reviewed status | Evidence |
|---|---|---|---|---|
| M.1 | Sheet with six tabs, service account, bot invited | Done (setup and verify scripts) | Partial | `npm run setup:sheets` and `npm run verify:sheets` exist. A live spreadsheet, a service-account share, and a Discord invite are environment state. This repository does not record them. |
| M.2 | Message id to church, and the reaction-started registration | Done | Works today | Same evidence as MVP-000 and MVP-001, including the approved deviation that the first reaction writes pending rows. |
| M.3 | Driver ask and reply handling against the Sheet | Done | Partial | The ask post, reaction opt-in, and `/rides sync` catch-up are implemented and tested. The YES/NO reply path is the leftover described under MVP-004. |
| M.4 | Assignment as a pure function, with edge-case tests | Done | Works today | `assignByZone` in `src/assignment.ts` takes data in and returns rows. It does not read Discord or Sheets. `tests/assignment.test.ts` covers capacity, +1 seats, church isolation, same housing, distance, and PENDING drivers. |
| M.5 | Apps Script port, Saturday trigger, lock | Done; run the manual two-church check before relying on the trigger | Partial | `assignByZone_`, `createSaturdayAssignmentTrigger` (Saturday about 11:45 in the script timezone), and the script lock are in `apps-script/Code.gs`. The manual two-church check has no recorded result here. |
| M.6 | Bot sends assignment DMs and marks `notified` | Not built | Planned | Same evidence as MVP-007. |
| M.7 | Full dry-run week with seeded data for both churches | Not done | Planned | The steps are the manual acceptance test in [`discord-bot.md`](discord-bot.md). No result is stored in this repository. |
| M.8 | Pilot launch with both real churches | Not done | Planned | The code and tests use more than one church id in one guild and one workbook. Seed scripts use test ids. Nothing in the repository records a launch with real churches, or names the clubs that use it. |

## Added after the original §29 text

These are in the code. They are not a claim that a live week has been run.

- **Broadcasts.** `/rides broadcast name:<id>` posts a greeting, then one ride post or driver ask per listed church. A second run replaces that block. A scheduled broadcast leaves the block alone if it is already live for the week.
- **Schedules.** Rows in `Schedules` name the day, time, and an exact `/rides` command, a plain message, or both. The bot reads them every minute. A missed job still runs later in the same Monday-to-Sunday week. It is not replayed the next week.
- **Driver sign-up from a reaction or a button.** A reaction marks the person available immediately. Someone who is not yet a driver gets a PENDING row with 4 seats until the form is finished. The assignment pass skips PENDING drivers. Registration is one form for riders and drivers. `Members.canDrive` is informational. The old Drivers role is unused.

## Still outside this MVP

Web app, member portal, Postgres, SMS, guest rides, standing requests, waitlist autofill, detour-cost routing, calendar sync, and self-service church onboarding. Those remain in PRD sections 1 to 28. There is no web app in this repository.
