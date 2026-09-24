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
7. Invite the bot to both guilds with `bot` and `applications.commands` scopes.
   In each weekly channel allow **View Channel**, **Send Messages**, **Embed Links**,
   **Read Message History**, **Add Reactions**, and members' **Use Application Commands**.
   Users must allow DMs from server members. The bot uses Guilds, GuildMessages,
   GuildMessageReactions and DirectMessages intents; no privileged Message Content
   intent is required for replies in DMs.
8. Run `npm start` as **one persistent process**. Commands register in each configured
   guild. `/register` only works in its configured weekly channel. `/rides` commands
   require **Manage Server**, checked at execution as well as in command permissions.
   A new church row + guild invite is discovered on the next minute tick.

Configuration is environment-only; no real token or Sheet ID belongs in source.
`npm start` loads `.env` if present and also works with deployment-injected variables.

## Supporting columns

The user approved adding fields omitted from §29.5 but needed by Section 4.
Existing columns may be reordered; code maps them by header name.

| Tab | Additional columns | Who sets them |
|---|---|---|
| Churches | `timezone`, `weeklySendDay`, `weeklySendTime`, `weeklyMessageTemplate` | Admin: IANA timezone (e.g. `America/Los_Angeles`), full English weekday (e.g. `Wednesday`), 24h `HH:mm`, and post text (max 2000 characters). No guessed timezone/schedule defaults. |
| Churches | `activeMessageId`, `activeWeekDate`, `availabilityResetWeek` | Bot. Leave blank initially. Dates are the service Sunday, `YYYY-MM-DD`. |
| Churches | `assignmentCompletedWeek` | Future assignment integration, or admin after a manual assignment run. Set to the service Sunday only **after assignments have actually completed**. Leave blank for this pass. |
| Members | `phone`, `preferences`, `notificationPreference` | Registration; preference is `DISCORD_DM` in this MVP. |
| RideRequests | `plusOnePhone`, `plusOnePromptId` | Bot; guest phone and the pending DM prompt. Guest names remain in the base `plusOneName` field. |
| Drivers | `isActive` | Admin; blank/TRUE means active, FALSE disables asks/replies. |
| Drivers | `availabilityWeek`, `askedWeek`, `askMessageId`, `respondedWeek` | Bot; scopes/reset/reply context for each week. |

`Churches.churchId` and `discordGuildId` must each be unique. Each other row's
`churchId` must match a configured church. The same Discord user can belong to both
churches; use distinct driver/member rows for each. Each driver needs a unique
`driverId`, its `churchId`, `name`, `discordId`, `seatsAvailable`, and `homeZone`.
Set `isAvailableThisWeek` to FALSE initially. `memberId` is optional and does not
prevent a driver from requesting a passenger ride when they answer NO.

`Members.zone` stores the chosen `Zones.zoneName`, not `zoneId`. Names within a
church should be unique. `driverAskChannelId` remains part of the base Church
configuration; the MVP asks drivers privately by DM instead of posting in that channel.

Boolean cells are written as actual Sheets booleans. User text is written with
`RAW` input mode so names/preferences beginning with `=` cannot become formulas.

## Timing, replies and recovery

- The minute scheduler uses each church's timezone, including DST. The service
  week ends on the local Sunday (Sunday itself still belongs to that week).
- Weekly posts use the configured day/time. Missed posts are caught up on startup
  or the next tick. A church gets one active post per service week; `/rides post`
  is safe to repeat. Posts carry a recovery marker so a send followed by a failed
  Sheet update can be found again without posting another message.
- On the first tick in a new local service week, stale driver availability resets
  to FALSE, including after downtime. Thursday 12:00 asks each active driver;
  missed asks catch up through Saturday 11:44. Nonresponders remain FALSE.
- Admin `/rides ask-drivers` also works immediately for testing and re-sends only
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

Use test users in two test guilds and watch the Sheet after each action. All dates
below mean the coming local service Sunday, not today's date.

1. **Registration in both churches:** run `/register` in each weekly channel using
   the same Discord account. Submit name, `+12025550123`, preferences; choose a
   local zone, then Discord DM. Expect two `Members` rows with different member IDs
   and correct `churchId`s, and two welcome DMs. Repeat in church A with a new name
   and **Other / Not Listed**: the existing A row updates; B is unchanged. Invalid
   phones must fail without a row. In another channel, `/register` must refuse.
2. **Post and ride:** as an admin run `/rides post` in both guilds. Expect the
   configured text and ✅/1️⃣ anchors; correct `activeMessageId`/`activeWeekDate` in
   each Church row. Run it twice: no duplicate. React ✅ in A: exactly one PENDING
   A request. Remove it: CANCELLED. Re-add: same requestId becomes PENDING. React
   in B: a separate B row. Reactions to unrelated/previous-week messages do nothing.
   A user without registration must receive a `/register` DM and create no request.
3. **Guest:** react 1️⃣ after ✅. Reply to that DM with `Test Guest` on line 1 and
   `+12025550123` on line 2. Expect `hasPlusOne=TRUE`, name and phone on that week's
   request only. Invalid phones must not save. Remove 1️⃣: FALSE and cleared name/
   phone. Re-add and submit another guest: same ride row, still only one guest.
   React 1️⃣ before ✅: guidance to request your own ride first.
4. **Driver replies:** seed driver rows for the same Discord account in both
   churches; run `/rides ask-drivers` in each. Expect two labeled DMs, FALSE default,
   and distinct saved ask IDs. Send bare `YES`: the bot must ask you to select a
   prompt. Reply `yes` to A's ask: only A becomes TRUE. Reply `maybe`: error and no
   change. Reply `NO` to A's ask: only A becomes FALSE. B remains FALSE until its
   own valid answer. A driver who says NO can still react ✅ for a passenger ride.
   Re-run `/rides ask-drivers`: only nonresponders are asked. A non-admin cannot run it.
5. **Restart/offline:** stop the bot; add ✅ for one user and remove ✅/1️⃣ for
   another. Start it again: requests/guest fields reconcile. Reply to a previously
   sent driver/+1 DM after restart: it still targets its original church. Run
   `/rides sync` twice: no duplicate rows or completed guest prompts.
6. **Schedules:** on test Church rows set `weeklySendDay` to today, `weeklySendTime`
   a minute ahead, and clear `activeMessageId`/`activeWeekDate` for a fresh test week.
   Confirm a post on the next tick and no second post after restart. Check Thursday
   noon asks and the next week's availability reset (timezone/DST behavior is also
   covered by automated tests). Clear test state before running a real service week.
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
