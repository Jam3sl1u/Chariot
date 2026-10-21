# Chariot — Church Rides MVP

Chariot coordinates weekly church rides for multiple churches that share one Discord guild and one
Google Sheet. This repo is the **Discord + Google Sheets MVP** defined in PRD §29
([`documentation/prd/Chariot_PRD_v2_3.md`](documentation/prd/Chariot_PRD_v2_3.md)) — the lightweight
phase that precedes the full platform in PRD §1–28.

- **Discord bot** (Node.js / discord.js) — registration form, ride requests by reaction, driver
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
| `npm run setup:sheets` | Appends the approved supporting headers to the existing tabs and creates the `Broadcasts` and `Schedules` tabs if missing (bot stopped). |
| `npm run verify:sheets` | Checks API access and headers without printing IDs or data. |
| `npm run migrate:zones-global` / `seed:priority-zones` / `seed:routing-data` | One-time zone and routing-data setup. |
| `npm run seed:assignment-test` / `verify:assignment-test` | Seed and check two-church assignment test data. |
| `npm run typecheck` / `npm test` | Static checks and automated tests (no live Discord or Sheet access). |
| `npm run changelog:generate` / `changelog:check` | Generate or verify the README and `CHANGELOG.md` history from commits on `main`. |

## Development workflow

Every branch push runs type-checking and tests. Open pull requests also receive a changelog preview
comment; use a concise title beginning with `feat:`, `fix:`, `docs:`, `test:`, `ci:`, `chore:` or
`refactor:`. Each merge to `main` creates a dated GitHub Release and a follow-up that updates the
change history below. The landing commit itself is not listed until that follow-up. Do not edit the
content between the changelog markers by hand—run `npm run changelog:generate` instead.

The follow-up uses the Actions token and pushes that synchronization straight to `main`. To attribute
it to a GitHub App instead, install a repository-scoped app with **Contents**, **Pull requests**, and
**Issues** read/write on this repository only. Set its client ID as `CHANGELOG_APP_CLIENT_ID` and its
private key as `CHANGELOG_APP_PRIVATE_KEY`. The app then opens and merges a pull request. Those
settings live in GitHub, not in this repository.

## MVP requirement status (PRD §29.6)

Status reflects the code on `main`. "Not built" means no code exists for it yet.

| ID | Requirement (short) | Status | Where |
|---|---|---|---|
| MVP-000 | Resolve `(guild, channel, message)` → one `churchId` via `activeMessageId`; drop unknown/ambiguous | Done | `src/service.ts`, `src/bot.ts` |
| MVP-001 | One registration form (name, phone, preferences, seats for drivers, location), opened from a **Register** button under each post (in a broadcast, only under the greeting) or from the DM an unregistered reactor gets; reusable across churches. A reactor gets a PENDING member row until the form is done. **Deviates from PRD (approved by James):** the first reaction also writes a PENDING `Members` row and a `RideRequests` row (the PRD says neither), and phone is free text rather than E.164. | Done, awaiting the manual acceptance test | `src/service.ts`, `src/bot.ts` |
| MVP-002 | Any emoji reaction add/remove creates/cancels a `RideRequests` row for that church and week | Done | `src/service.ts` |
| MVP-003 | +1/guest flow | Deferred (PRD: decide later) | — |
| MVP-004 | Driver YES/NO reply sets `isAvailableThisWeek` for that driver's church | Done | `src/service.ts`, `src/bot.ts` |
| MVP-005 | Saturday Apps Script loops `Churches` and assigns riders to drivers per church, never mixing churches | Done in Apps Script, not yet verified against live data. The matching prefers same housing, then seeded distance, then zone priority, which goes beyond §29's "fixed zone-priority" wording. | `apps-script/Code.gs`, `src/assignment.ts` |
| MVP-006 | Unseated riders written with blank `driverId` and an `unassignedReason` | Done | `apps-script/Code.gs` |
| MVP-007 | Bot-side trigger DMs drivers and members their results and sets `notified = true` | **Not built.** The `notified` column exists, but no bot code reads it. | — |
| MVP-008 | Apps Script holds a script lock for its run | Done | `apps-script/Code.gs` (`LockService`) |
| MVP-009 | Clear active-post and availability state on every process start; no automatic scheduled work | **Superseded by James's decision.** Scheduled work is now in scope (see "Added beyond PRD §29"). Commit `e9a7d1f` also stopped clearing state on startup, deliberately. The timer only touches a church that has an enabled `Schedules` row. | `src/bot.ts`, `src/schedule.ts` |

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

- **Scheduled flows:** the bot runs a one-minute scheduler. Jobs are rows in the `Schedules` tab (day,
  time, and a `/rides` command, a plain message, or both). A job missed while the bot was down runs when it
  is back, as long as it is still the same Monday-to-Sunday week. This replaces PRD BOT-010/013
  ("no scheduler") for this repo; the PRD is unchanged. Run `npm run setup:sheets` first to create the tab.
  See [docs/discord-bot.md](docs/discord-bot.md#scheduled-jobs-schedules-tab).

- **Driver sign-up by reaction or button:** reacting to a driver ask makes the driver available at once. A reaction by a
  non-driver creates a placeholder `Drivers` row (`signupStatus` PENDING, 4 seats) that the one-step registration form completes;
  people who already drive for another church are added automatically. Registration is one popup for riders and drivers,
  `Members.canDrive` flags who can drive, and `discordUsername` is recorded on Members and Drivers. The Drivers role is gone. `/rides sync` also catches up driver reactions. Run
  `npm run setup:sheets` before deploying, to add the new columns (`signupStatus`, `canDrive`, `discordUsername`). See [docs/discord-bot.md](docs/discord-bot.md#driver-reactions-and-sign-up).

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

<!-- changelog:start -->
## Change history

- **Changes** — 2026-10-21 — [Merge pull request #5 from Jam3sl1u/fix-changelog-release](https://github.com/Jam3sl1u/Chariot/commit/41b5b28ba9a94186c3fa743ae4380de8d5414e53) (41b5b28)
- **Fixes** — 2026-10-21 — [refresh the changelog when no GitHub App is configured](https://github.com/Jam3sl1u/Chariot/commit/1d7b6a98907917fe5bdcb4dcc610e5049c777cae) (1d7b6a9)
- **Changes** — 2026-10-21 — [Merge pull request #4 from Jam3sl1u/fix-release-checks](https://github.com/Jam3sl1u/Chariot/commit/902c21c76aa52911e3cd0854e3d67ca6b251266a) (902c21c)
- **Fixes** — 2026-10-21 — [accept the GitHub App client id in the release workflow](https://github.com/Jam3sl1u/Chariot/commit/60f41c965e37ac10bc121b82e4bb498d8fe5e47a) (60f41c9)
- **Changes** — 2026-10-20 — [Merge pull request #3 from Jam3sl1u/automated-changelog-workflow](https://github.com/Jam3sl1u/Chariot/commit/43d2e034a3a38e7627bcdd68f7977715b62d460b) (43d2e03)
- **Fixes** — 2026-10-20 — [resolve changelog history in CI](https://github.com/Jam3sl1u/Chariot/commit/7ffda91765ba69970ca8fea9774bc39201d986ae) (7ffda91)
- **Changes** — 2026-10-20 — [Enhance documentation and scripts for changelog management. Add new commands for generating and checking changelogs in package.json. Update AGENTS.md and READM…](https://github.com/Jam3sl1u/Chariot/commit/b554c3d4b25cf7c062777243dd849399f2b989ed) (b554c3d)
- **Changes** — 2026-10-14 — [Update README and Discord bot logic to clarify the behavior of the Register button. Ensure that only the greeting message carries the Register button for rides…](https://github.com/Jam3sl1u/Chariot/commit/b84315e968214b5afe8f9d1157c42b62ec7203b2) (b84315e)
- **Changes** — 2026-10-13 — [Merge pull request #2 from Jam3sl1u/scheduled-flows](https://github.com/Jam3sl1u/Chariot/commit/2bb199dca27807bdcc0fcd4cb24f07b0d1405400) (2bb199d)
- **Changes** — 2026-10-13 — [Merge origin/main into scheduled-flows.](https://github.com/Jam3sl1u/Chariot/commit/8f5bb1f2a08a9b4bc458a9be6232e69eb2114081) (8f5bb1f)
- **Changes** — 2026-10-13 — [Merge pull request #1 from Jam3sl1u/registration-form-flow-edits](https://github.com/Jam3sl1u/Chariot/commit/f80f259bdaa739aaa8e8a0cfac310da7861d02d6) (f80f259)
- **Documentation** — 2026-10-12 — [Update Discord bot documentation to clarify persistence of scheduling state; specify behavior for activeMessageId, activeWeekDate, and availabilityResetWeek ac…](https://github.com/Jam3sl1u/Chariot/commit/d3735c543bea684f6a524595d60d46ac4d498d67) (d3735c5)
- **Changes** — 2026-10-12 — [Refine Discord bot scheduling logic; update documentation to clarify message handling and timezone settings. Enhance error reporting for message confirmation f…](https://github.com/Jam3sl1u/Chariot/commit/d8106b50961a7291b313cc9335f0c35422cf3f3e) (d8106b5)
- **Changes** — 2026-10-12 — [Update README and documentation for Discord bot scheduling; clarify message handling and error reporting for scheduled jobs. Enhance bot logic to manage messag…](https://github.com/Jam3sl1u/Chariot/commit/62897b5e8dbba6c4384b731352c2332d4f3444f1) (62897b5)
- **Changes** — 2026-10-12 — [Update registration workflow in Discord bot; clarify deviations from PRD in README and documentation, including changes to the registration form and driver ava…](https://github.com/Jam3sl1u/Chariot/commit/71ef9776bcf6bac237f872dab43baf620501feb1) (71ef977)
- **Changes** — 2026-10-10 — [Implement scheduling functionality in Discord bot; add support for scheduled jobs via a new Schedules tab in Sheets, allowing automated execution of commands a…](https://github.com/Jam3sl1u/Chariot/commit/cd9f4a733cfe00d0ee3b80928f03381230dda667) (cd9f4a7)
- **Changes** — 2026-10-10 — [Refine driver registration process in Discord bot; implement a unified registration form for both riders and drivers, ensuring seamless sign-up and availabilit…](https://github.com/Jam3sl1u/Chariot/commit/67527141db030fc51ebc5399aab88e80cf75844e) (6752714)
- **Changes** — 2026-10-08 — [Enhance driver sign-up process in Discord bot; implement placeholder rows for unregistered users reacting to driver asks, ensuring they are prompted for sign-u…](https://github.com/Jam3sl1u/Chariot/commit/fc9f7a893325b46264bdba1dfe9779516fb96d37) (fc9f7a8)
- **Changes** — 2026-10-08 — [Refine command validation for Discord bot; enforce channel-specific execution for '/rides' commands. Update documentation to clarify command usage for 'post',…](https://github.com/Jam3sl1u/Chariot/commit/429c102a30cad65a7d0230abc70c4f0a4cf3ad22) (429c102)
- **Changes** — 2026-10-08 — [Enhance driver sign-up process in Discord bot; implement reaction-based registration for drivers and update documentation to clarify the new workflow. Modify s…](https://github.com/Jam3sl1u/Chariot/commit/96e854934c4ee385d36b7d0e433f721e76a49294) (96e8549)
- **Changes** — 2026-10-06 — [Implement rate limit handling and message cleanup for Discord bot; enhance Sheets interaction with retry logic for error responses. Update documentation to cla…](https://github.com/Jam3sl1u/Chariot/commit/de89d32410fe31ec1827f8dedcc9f81b1a8b263f) (de89d32)
- **Changes** — 2026-10-06 — [Refine Discord bot command validation and error reporting; enforce channel-specific execution for broadcasts. Update documentation to clarify command usage and…](https://github.com/Jam3sl1u/Chariot/commit/fccbc8d5798c66b947e695c2d1cc50d4576fe530) (fccbc8d)
- **Changes** — 2026-10-06 — [Improve error handling and validation in broadcast functionality; enhance reporting of issues with church configurations and broadcast parameters. Update docum…](https://github.com/Jam3sl1u/Chariot/commit/2d69213929e92a12fcef5fa7ef6491ba8c7db68d) (2d69213)
- **Changes** — 2026-10-06 — [Enhance README and documentation for new Broadcasts feature; update bot commands to include broadcast functionality and improve Sheets setup process. Add servi…](https://github.com/Jam3sl1u/Chariot/commit/c78dddf2326f8eef52149c6c31e1bbc4a6ff9394) (c78dddf)
- **Changes** — 2026-10-06 — [Update AGENTS.md and README.md to reflect changes in project scope and clarify operational guidelines; remove unnecessary sections. Also, update .gitignore to…](https://github.com/Jam3sl1u/Chariot/commit/541caa96fd07d4aa51bb7315f787c6eabcd84f41) (541caa9)
- **Changes** — 2026-10-06 — [Remove run-loop script, which facilitated unattended Chariot build loops, due to redundancy or deprecation of functionality.](https://github.com/Jam3sl1u/Chariot/commit/bef33e93bb9c6608f4f44850b46bf754b12c9e3b) (bef33e9)
- **Changes** — 2026-09-29 — [Add shared driver availability channel](https://github.com/Jam3sl1u/Chariot/commit/e6a1b5f9ff0f9f53bca08b0056972276c899a30a) (e6a1b5f)
- **Changes** — 2026-09-27 — [Preserve weekly state across bot restarts](https://github.com/Jam3sl1u/Chariot/commit/e9a7d1f297c16c1c734c17f6f6a32fe0cd162592) (e9a7d1f)
- **Changes** — 2026-09-27 — [Merge branch 'astra-mvp'](https://github.com/Jam3sl1u/Chariot/commit/7f33ed39ea8ddaada3978a2cb13bbdaee433e1f6) (7f33ed3)
- **Changes** — 2026-09-27 — [Add routing data seeding script; enhance assignment logic to prioritize same housing and distance for rider assignments](https://github.com/Jam3sl1u/Chariot/commit/5fed620849e56005c532dbb2f5aeddee01349aa1) (5fed620)
- **Changes** — 2026-09-27 — [Add shared zones functionality and update related scripts; enhance registration process for unregistered users](https://github.com/Jam3sl1u/Chariot/commit/fbe566d6fb5fe108aeb8c94eea4ddf8d784b3533) (fbe566d)
- **Changes** — 2026-09-27 — [Add assignment seeding and verification scripts; update documentation for Saturday assignment process](https://github.com/Jam3sl1u/Chariot/commit/b2836b8c46c0ad314591e4552a905afa9dc8c5ec) (b2836b8)
- **Changes** — 2026-09-27 — [Reuse registration across churches](https://github.com/Jam3sl1u/Chariot/commit/e98e71ff05a4a506d987fbab92506377a012aa07) (e98e71f)
- **Changes** — 2026-09-27 — [Accept any reaction for ride signup](https://github.com/Jam3sl1u/Chariot/commit/6d9c96f3d0adea2a2e1cd7deb31848aa7091a76d) (6d9c96f)
- **Changes** — 2026-09-27 — [Add configurable registration DM templates](https://github.com/Jam3sl1u/Chariot/commit/7c72f6935ff197e4b35d7e20b76471a3b29fa73c) (7c72f69)
- **Changes** — 2026-09-27 — [DM reaction registration prompt without removal](https://github.com/Jam3sl1u/Chariot/commit/0308de9a22c84f9a0bf49f9fb7a1895cbdd5dfb3) (0308de9)
- **Changes** — 2026-09-27 — [Keep registration confirmations in channel](https://github.com/Jam3sl1u/Chariot/commit/f9dbdda22a77b228f8010f097dd7d3a2a2bda7ff) (f9dbdda)
- **Changes** — 2026-09-27 — [Hide internal weekly post marker](https://github.com/Jam3sl1u/Chariot/commit/2163325642640f64d8a2c23198ade8df08fb18fe) (2163325)
- **Changes** — 2026-09-27 — [Create fresh Discord posts in manual mode](https://github.com/Jam3sl1u/Chariot/commit/b5b10c846db355eeda4e0443f353c2c4d93c134f) (b5b10c8)
- **Changes** — 2026-09-27 — [Label failed manual ride commands](https://github.com/Jam3sl1u/Chariot/commit/9676d7007c34142183f3865567aa65c50a5cfd20) (9676d70)
- **Changes** — 2026-09-27 — [Run Discord bot in manual startup mode](https://github.com/Jam3sl1u/Chariot/commit/c7b1387e5b78b70624c53770f174c32df094cdc7) (c7b1387)
- **Changes** — 2026-09-27 — [Recover from missing weekly Discord posts](https://github.com/Jam3sl1u/Chariot/commit/966d6faf53157871ac8c6d1905b1b6dd662b6e3c) (966d6fa)
- **Changes** — 2026-09-27 — [Document the local service-account path in .env.example and drop unused PRD loop files.](https://github.com/Jam3sl1u/Chariot/commit/187c992e3b2e6cc06b59d16d318e9cca33fc2aa5) (187c992)
- **Changes** — 2026-09-27 — [Start registration surveys in channel](https://github.com/Jam3sl1u/Chariot/commit/540880f1dcba5a353b0a8519d6b6bb983c7c55a9) (540880f)
- **Changes** — 2026-09-27 — [Report safe Discord startup error codes](https://github.com/Jam3sl1u/Chariot/commit/baf8de28869e223e653bc13e4785e8359c2ef858) (baf8de2)
- **Changes** — 2026-09-27 — [Add reaction initiated registration surveys](https://github.com/Jam3sl1u/Chariot/commit/bd1a824a0a3ca5a8b24cfed2e3dcd9eae1429c84) (bd1a824)
- **Documentation** — 2026-09-27 — [Specify shared-channel reaction registration flow](https://github.com/Jam3sl1u/Chariot/commit/d6d8b491ff85b7838a48874a59aea203c30bacab) (d6d8b49)
- **Changes** — 2026-09-27 — [Support multiple churches per Discord guild](https://github.com/Jam3sl1u/Chariot/commit/222208da89a0246acccf5f9979588d6b108e7a28) (222208d)
- **Documentation** — 2026-09-24 — [Record MVP validation and verifier profile blocker](https://github.com/Jam3sl1u/Chariot/commit/7d811882c951b286c177e34829998ad9b79a4868) (7d81188)
- **Changes** — 2026-09-24 — [Implement MVP-000–004 Discord registration and driver flows with Sheets](https://github.com/Jam3sl1u/Chariot/commit/0781088fac363dd9ab588021af1d761777083a37) (0781088)
- **Changes** — 2026-09-24 — [Merge branch 'main' of https://github.com/Jam3sl1u/Chariot](https://github.com/Jam3sl1u/Chariot/commit/2d381376c0002be7e739be5a228b0a2ecc9ce18a) (2d38137)
- **Changes** — 2026-09-24 — [Refactor README.md, config.toml, and GOAL.md to clarify user-scoped Codex profiles and the commit verification process. Update run-loop.sh to prioritize the st…](https://github.com/Jam3sl1u/Chariot/commit/8c6f142fe4f37208787d9b2a9e6d5b556ff4e8da) (8c6f142)
- **Documentation** — 2026-09-24 — [Update AGENTS.md and README.md to enhance clarity on the verification process and local commit importance. Revise config.toml for improved model settings and a…](https://github.com/Jam3sl1u/Chariot/commit/7d40568ea241207ebad3f4ac139216a6111d77b8) (7d40568)
- **Changes** — 2026-09-24 — [Set up project for Codex: env-based config, PRD v2.3 paths, sheets verification script](https://github.com/Jam3sl1u/Chariot/commit/25be4d6f0177e8a14424e0d9bee080a0b0b2e3e7) (25be4d6)
- **Changes** — 2026-07-22 — [Refine AGENTS.md, README.md, and GOAL.md to clarify the commit and verification process. Emphasize the importance of local commits before pushing and the indep…](https://github.com/Jam3sl1u/Chariot/commit/207f136b4f84220027e79acdbc337eacb2d62479) (207f136)
- **Changes** — 2026-07-22 — [Enhance AGENTS.md with mandatory self-check guidelines before ending turns, and update README.md to clarify Codex desktop app usage and unattended operation. R…](https://github.com/Jam3sl1u/Chariot/commit/82dbad3d7c2048c13f42b3f99b905846fad482e6) (82dbad3)
- **Changes** — 2026-07-21 — [Update README.md, config.toml, and GOAL.md to clarify Codex loop operation and remove non-existent features. Adjusted profiles for build and verifier, and emph…](https://github.com/Jam3sl1u/Chariot/commit/2b4f2d836b599ea55b524402a6f1c8333b592425) (2b4f2d8)
- **Changes** — 2026-07-21 — [Update extensions.json to include new extensions and remove deprecated ones.](https://github.com/Jam3sl1u/Chariot/commit/314b14dda7261c2c1eb81389710d591b5be5973c) (314b14d)
- **Changes** — 2026-07-21 — [extensions.json](https://github.com/Jam3sl1u/Chariot/commit/f572aaf710bf8c4fb27c2ae44a85a1a83e3790ff) (f572aaf)
<!-- changelog:end -->
