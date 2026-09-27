# Chariot Discord + Sheets MVP

Implements MVP-000–004 and the Discord portions of BOT-001–030 under PRD §29.
The PRD is at `documentation/prd/Chariot_PRD_v2_3.md`.

The MVP uses Discord DMs, per §29.2–29.4. There is no SMS selector, portal link,
password setup, standing request, assignment computation, waitlist autofill, or
assignment-result notification job. Registering updates by `(churchId, discordId)`.
Pickup choices come from that church's `Zones` rows plus **Other / Not Listed**.
Admin availability overrides happen by editing the Sheet; `/rides ask-drivers`
re-sends prompts to nonresponders. Guild channel chat is ignored.

## Install and configure

1. Install Node.js 22.12+ and run `npm ci`.
2. Copy `.env.example` to `.env`. Set `DISCORD_BOT_TOKEN`, `GOOGLE_SHEET_ID`, and
   `GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./service-account-key.json` locally. Keep the
   JSON key in that location or provide its absolute path. Never commit either file.
   The legacy `SHEET_ID` / `GOOGLE_APPLICATION_CREDENTIALS` variables are no longer used.
3. Enable Google Sheets API for the service account's project. Share your Sheet
   with the service account's `client_email` as an editor.
4. Create the six tabs with the base headers specified in PRD §29.5: `Churches`,
   `Members`, `Drivers`, `Zones`, `RideRequests`, `Assignments`. Headers are case
   sensitive; keep row 1 contiguous. Keep IDs as **Plain text**, especially Discord
   snowflakes (numeric cells can lose precision).
5. Run `npm run setup:sheets`. This appends the approved supporting headers to the
   existing tabs, preserving their order and data. It does not create tabs, seed
   accounts, or read/write `Assignments`. Run it with the bot stopped.
6. Configure every `Churches` row as described below. Run `npm run verify:sheets`
   to check API access and headers without printing IDs, member data or credentials.
7. Invite the bot to the shared guild with `bot` and `applications.commands` scopes.
   In the shared weekly channel allow **View Channel**, **Send Messages**, **Embed Links**,
   **Read Message History**, **Add Reactions**, **Manage Messages** (to remove an
   unregistered member's reaction), and members' **Use Application Commands**.
   Users must allow DMs from server members. The bot uses Guilds, GuildMessages,
   GuildMessageReactions and DirectMessages intents; no privileged Message Content
   intent is required for replies in DMs.
8. Run `npm start` as **one persistent process**. All churches share one configured
   guild and weekly channel. An unregistered member starts that church's survey by
   reacting to its weekly post; `/register` only repeats these instructions. `/rides`
   commands require **Manage Server** and an explicit `church` ID, checked at execution
   as well as in command permissions. A new church row is discovered on the next minute tick.

Configuration is environment-only; no real token or Sheet ID belongs in source.
`npm start` loads `.env` if present and also works with deployment-injected variables.

## Supporting columns

The user approved adding fields omitted from §29.5 but needed by Section 4.
Existing columns may be reordered; code maps them by header name.

| Tab | Additional columns | Who sets them |
|---|---|---|
| Churches | `timezone`, `weeklySendDay`, `weeklySendTime`, `weeklyMessageTemplate` | Admin: IANA timezone (e.g. `America/Los_Angeles`), full English weekday (e.g. `Wednesday`), 24h `HH:mm`, and post text (max 2000 characters). No guessed timezone/schedule defaults. |
| Churches | `activeMessageId`, `activeWeekDate`, `availabilityResetWeek` | Bot. Clears all three on every process start; dates are the service Sunday, `YYYY-MM-DD`. |
| Churches | `assignmentCompletedWeek` | Future assignment integration, or admin after a manual assignment run. Set to the service Sunday only **after assignments have actually completed**. Leave blank for this pass. |
| Members | `phone`, `preferences`, `notificationPreference` | Registration; preference is `DISCORD_DM` in this MVP. |
| RideRequests | `plusOnePhone`, `plusOnePromptId` | Bot; guest phone and the pending DM prompt. Guest names remain in the base `plusOneName` field. |
| Drivers | `isActive` | Admin; blank/TRUE means active, FALSE disables asks/replies. |
| Drivers | `availabilityWeek`, `askedWeek`, `askMessageId`, `respondedWeek` | Bot; scopes/reset/reply context for each week. |

`Churches.churchId` must be unique. Every church row uses the same `discordGuildId` and
`weeklyPostChannelId`; reactions are routed only by the weekly post's saved
`activeMessageId`. An unregistered reaction is ignored (and removed when the bot has
Manage Messages) while the bot posts that member's church-specific **Start registration** button in the shared channel. Each other row's `churchId` must match a configured
church. The same Discord user can belong to both churches; use distinct driver/member rows for each. Each driver needs a unique
`driverId`, its `churchId`, `name`, `discordId`, `seatsAvailable`, and `homeZone`.
Set `isAvailableThisWeek` to FALSE initially. `memberId` is optional and does not
prevent a driver from requesting a passenger ride when they answer NO.

`Members.zone` stores the chosen `Zones.zoneName`, not `zoneId`. Names within a
church should be unique. `driverAskChannelId` remains part of the base Church
configuration; the MVP asks drivers privately by DM instead of posting in that channel.

Boolean cells are written as actual Sheets booleans. User text is written with
`RAW` input mode so names/preferences beginning with `=` cannot become formulas.

## Timing, replies and recovery

**Manual mode:** every process start clears `activeMessageId`, `activeWeekDate`, and
`availabilityResetWeek` for every church. The bot does not reconcile old reactions,
run the scheduler, post automatically, reset availability automatically, or send
driver asks automatically. It waits for an admin command. Use `/rides post church:ID`
to create a new weekly post, `/rides sync church:ID` to reconcile it, and
`/rides ask-drivers church:ID` to reset/ask drivers for that church. A post command
after a restart always creates a fresh message; old posts remain visible but inactive.

- Admin `/rides ask-drivers` works immediately for testing and re-sends only
  to drivers without a recorded response this week. To override availability,
  edit `isAvailableThisWeek` and set `availabilityWeek` to the current service Sunday.
  Set `respondedWeek` too if the override should suppress reminders/resends.
- Drivers reply **YES** or **NO**, case-insensitive, with no extra text or whitespace.
  They can change an answer by replying again to the original ask. Each +1 reply
  contains two lines: full name, then a US E.164 phone number. One guest per ride;
  a new 1️⃣ flow updates the existing guest.
- DMs have no guild ID. Context comes only from the persisted prompt, scoped to
  its intended Discord user and church; membership is rechecked before writes.
  Use Discord's **Reply** action on the original bot message when more than one
  prompt is pending. A bare reply is accepted only when exactly one prompt is pending.
  Context survives restarts; old-week prompts and other users' replies are rejected.
- Removing ✅ cancels the current week's request. Removing 1️⃣ clears guest details.
  Startup and `/rides sync` reconcile both emojis, including paginated lists over
  100 reactors. Re-registering does not itself create a ride request; react ✅ afterward.
- Saturday 10am is informational. The bot does not infer that an assignment ran
  merely because the clock passed 11:45. `assignmentCompletedWeek` closes new
  requests/+1 changes once the separate assignment pass completes. Cancellations
  stay available. Late driver YES saves availability and explains that an admin
  must arrange placement; this pass does not change `Assignments` or invoke autofill.

Keep one bot instance running. The in-process queue prevents competing bot writes,
but Google Sheets has no transactions/unique constraints: don't sort/delete data
rows while the bot is writing. The bot only patches named cells, preserving unrelated
admin fields. Apps Script `LockService` does **not** lock writes made through the
external Sheets API; snapshot/coordination with the future assignment job belongs
in that separate pass. Discord send and Sheet save also cannot form one transaction;
a failure between them can require a resend or `/rides sync`.

## Exact manual acceptance test

Use test users in one shared test guild and channel and watch the Sheet after each action. All dates
below mean the coming local service Sunday, not today's date.

1. **Registration in both churches:** as an admin, run `/rides post church:church-a`
   and `/rides post church:church-b` in the shared channel. Each post has its own ✅/1️⃣
   anchors and saved `activeMessageId`. React ✅ to A as a new user: the reaction is
   removed, an in-channel Church A **Start registration** button appears, and no request exists. Complete the survey
   with name, `+12025550123`, preferences, and a local zone; then react ✅ to A again.
   Expect one PENDING A request. Repeat from B's post with the same account: expect a
   distinct B `Members` row and B request. Invalid survey data must not create a row.
2. **Post routing and cancellation:** re-run either church's `/rides post` command:
   expect no duplicate for that church. Remove ✅ from A: only A becomes CANCELLED.
   Re-add it: the same A request becomes PENDING. Reactions to unrelated or
   previous-week messages do nothing.
3. **Guest:** react 1️⃣ after ✅. Reply to that DM with `Test Guest` on line 1 and
   `+12025550123` on line 2. Expect `hasPlusOne=TRUE`, name and phone on that week's
   request only. Invalid phones must not save. Remove 1️⃣: FALSE and cleared name/
   phone. Re-add and submit another guest: same ride row, still only one guest.
   React 1️⃣ before ✅: guidance to request your own ride first.
4. **Driver replies:** seed driver rows for the same Discord account in both
   churches; run `/rides ask-drivers church:church-a` and then `church:church-b`.
   Expect two labeled DMs, FALSE default,
   and distinct saved ask IDs. Send bare `YES`: the bot must ask you to select a
   prompt. Reply `yes` to A's ask: only A becomes TRUE. Reply `maybe`: error and no
   change. Reply `NO` to A's ask: only A becomes FALSE. B remains FALSE until its
   own valid answer. A driver who says NO can still react ✅ for a passenger ride.
   Re-run `/rides ask-drivers`: only nonresponders are asked. A non-admin cannot run it.
5. **Restart/manual reset:** stop and start the bot. Confirm both Church rows have
   blank `activeMessageId`, `activeWeekDate`, and `availabilityResetWeek`, and no
   post/driver ask occurs on its own. Run `/rides post church:church-a` and `/rides sync
   church:church-a`; confirm the new post is the only active one and repeated syncs
   create no duplicate rows or guest prompts. Reply to a previously sent driver/+1 DM
   after restart: it still targets its original church.
6. **Manual driver asks:** run `/rides ask-drivers church:church-a`; confirm availability
   is reset and only the appropriate drivers are asked. The configured schedule fields
   are retained for future automation but do not trigger actions in this manual mode.
7. **Tenant/stale protections:** reply to an old-week prompt or another user's
   prompt: no write. Remove a test guild mapping after its prompts have been sent:
   further events must not write under another church. Duplicate mappings must log
   an ambiguity and drop writes. Restore the valid Church rows afterward.
8. **Assignment boundary:** in church A only, manually set `assignmentCompletedWeek`
   to the current service Sunday. A fresh ✅ or guest addition must be refused;
   removal of ✅ still cancels. B remains open. Clear this test marker afterward.
   After Saturday 11:45 a driver YES is saved with a manual-placement notice;
   verify that `Assignments` remains untouched.
9. **DM failure:** disable server DMs on a test user, then register. Registration
   must still save and the ephemeral response must explain the failed welcome DM.
   Re-enable DMs and retry guest/driver prompts with reactions or `/rides ask-drivers`.

Automated checks: `npm run typecheck` and `npm test` (Node's built-in test runner,
no Jest/Playwright infrastructure). They use in-memory Sheets/Discord doubles;
they do not authenticate, send real DMs or alter your live Sheet.

API references: [discord.js client](https://discord.js.org/docs/packages/discord.js/main/Client:Class),
[Google Sheets value writes](https://developers.google.com/workspace/sheets/api/guides/values).
