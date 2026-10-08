# Chariot Discord + Sheets MVP

Implements MVP-000–004 and the Discord portions of BOT-001–030 under PRD §29.
The PRD is at `documentation/prd/Chariot_PRD_v2_3.md`.

The MVP uses Discord DMs, per §29.2–29.4. There is no SMS selector, portal link,
password setup, standing request, waitlist autofill, or assignment-result notification
job. Registering updates by `(churchId, discordId)`.
Pickup choices come from the shared `Zones` registry plus **Other / Not Listed**.
Admin availability overrides happen by editing the Sheet. Drivers opt in by reacting to their
church's driver ask post (see below). Guild channel chat is ignored.

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
   existing tabs, preserving their order and data. It does not create tabs or seed
   accounts. Run it with the bot stopped.
6. Configure every `Churches` row as described below. Run `npm run verify:sheets`
   to check API access and headers without printing IDs, member data or credentials.
   Run `npm run migrate:zones-global` once to convert old church-scoped zone rows
   into one shared registry, then `npm run seed:priority-zones` to populate the
   agreed UCI housing zones. The seed is safe to rerun: matching names are updated
   and missing names are added.
7. Invite the bot to the shared guild with `bot` and `applications.commands` scopes.
   In the shared weekly channel allow **View Channel**, **Send Messages**, **Embed Links**,
   **Read Message History**, **Add Reactions**, and members' **Use Application Commands**.
   Users must allow DMs from server members. The bot uses Guilds, GuildMessages,
   GuildMessageReactions and DirectMessages intents; no privileged Message Content
   intent is required for replies in DMs.
8. Run `npm start` as **one persistent process**. All churches share one configured
   guild and weekly channel. An unregistered member starts that church's survey and
   creates a temporary ride request by reacting to its weekly post; `/register` only repeats these instructions. `/rides`
   commands require **Manage Server** and an explicit `church` ID, checked at execution
   as well as in command permissions. A new church row is discovered on the next minute tick.

Configuration is environment-only; no real token or Sheet ID belongs in source.
`npm start` loads `.env` if present and also works with deployment-injected variables.

## Supporting columns

The user approved adding fields omitted from §29.5 but needed by Section 4.
Existing columns may be reordered; code maps them by header name.

| Tab | Additional columns | Who sets them |
|---|---|---|
| Churches | `timezone`, `weeklySendDay`, `weeklySendTime`, `weeklyMessageTemplate`, `registrationDmTemplate` | Admin: IANA timezone (e.g. `America/Los_Angeles`), full English weekday (e.g. `Wednesday`), 24h `HH:mm`, weekly-post text (max 2000 characters), and optional registration-DM text (max 2000 characters). Use `{churchName}` in the DM template to insert that row's church name. A blank DM template uses the built-in message. No guessed timezone/schedule defaults. |
| Churches | `activeMessageId`, `activeWeekDate`, `availabilityResetWeek` | Bot. Clears all three on every process start; dates are the service Sunday, `YYYY-MM-DD`. |
| Churches | `assignmentCompletedWeek` | Future assignment integration, or admin after a manual assignment run. Set to the service Sunday only **after assignments have actually completed**. Leave blank for this pass. |
| Members | `phone`, `preferences`, `notificationPreference` | Registration; preference is `DISCORD_DM` in this MVP. |
| Members | `canDrive` | Bot, editable by admins. TRUE when the person volunteered or has a Drivers row in that church, FALSE when they registered as a rider only. Informational: nothing reads it to decide availability. |
| RideRequests | `hasPlusOne`, `plusOneName`, `plusOnePhone`, `plusOnePromptId` | Reserved for the deferred +1 feature; the MVP does not read or write them. |
| Drivers | `isActive` | Admin; blank/TRUE means active, FALSE disables asks/replies. |
| Drivers | `availabilityWeek`, `askedWeek`, `askMessageId`, `respondedWeek` | Bot; scopes/reset/reply context for each week. |
| Drivers | `signupStatus` | Bot. `PENDING` = a placeholder created by a reaction (4 seats until they finish sign-up); `COMPLETE` = they submitted the form or an admin added the row. Blank is treated as complete. Filter on `PENDING` to see who still owes a sign-up. |
| Assignments | `unassignedReason`, `assignmentStatus` | Assignment script. Status is `ASSIGNED`, `UNASSIGNED`, or `CANCELLED`; cancelled rows remain as history but do not occupy a seat. |

`Churches.churchId` must be unique. Every church row uses the same `discordGuildId` and
`weeklyPostChannelId`; reactions are routed only by the weekly post's saved
`activeMessageId`. An unregistered reaction remains visible but is ignored while the
bot DMs that member a **Start registration** button. Registration is shared across
all churches: after a member completes it once, reacting to any church's active post
creates a ride request using the same pickup location. The bot creates that church's
internal `Members` row only when needed, so assignments remain isolated. Each other
row's `churchId` must match a configured church. Each driver needs a unique
`driverId`, its `churchId`, `name`, `discordId`, `seatsAvailable`, and `homeZone`.
Set `isAvailableThisWeek` to FALSE initially. `memberId` is optional and does not
prevent a driver from requesting a passenger ride when they answer NO.

An initial reaction by an unregistered person creates a `Members` row with
`profileStatus = PENDING` and a `PENDING` ride request. Completing the
survey upgrades it to `COMPLETE`. An admin may instead complete a pending profile
directly in the sheet by supplying name, a valid phone, and zone; it then becomes
eligible even if the status cell is left as `PENDING`.

`Members.zone` stores the chosen `Zones.zoneName`, not `zoneId`. Names within a
church should be unique. `driverRoleId` is the Discord **Drivers** role that the bot
grants to a member who volunteers during registration; configure the channel so that
role can see and send messages. `driverAskChannelId` identifies the drivers channel.
Churches may share that channel, but each gets a weekly ask post saved as its
`driverAskMessageId`. Set `driverAskMessageTemplate` for each church; it supports
`{churchName}` and `{weekDate}`. Any reaction by an active driver on that church's
current post means they are available; removing it, or not reacting, means unavailable.
Signing up as a driver, by any route, never makes someone available: only a reaction does.

Boolean cells are written as actual Sheets booleans. User text is written with
`RAW` input mode so names/preferences beginning with `=` cannot become formulas.

## Broadcasts (one command for a greeting plus every church's message)

`/rides broadcast name:<broadcastId>` posts a greeting and then one message per church, in
order, using a row of the `Broadcasts` tab. `npm run setup:sheets` creates the tab (with its
headers) if it is missing. Restart the bot once after updating so Discord registers the new
subcommand. It is an addition to PRD §29, not part of it.

| Column | Who sets it | Meaning |
|---|---|---|
| `broadcastId` | Admin | The name typed in the command; must be unique. |
| `type` | Admin | `post` posts each church's weekly ride request (ride to church). `ask` posts each church's driver ask (drive to church). One broadcast is all one type. |
| `churches` | Admin | Comma-separated `churchId`s, posted in this order, e.g. `CH01, CH02`. |
| `greeting` | Admin | Posted first (max 2000 characters). `{weekDate}` becomes the service Sunday. |
| `greetingMessageId`, `greetingWeek` | Bot | Which greeting is live, so a re-run can delete it. |

Rules:

- Run it as an admin (Manage Server). **`post` runs only in the shared rides channel**
  (`weeklyPostChannelId`) and **`ask` runs only in the driver channel** (`driverAskChannelId`).
  Every listed church must use that guild and the same channel for its type. The greeting goes
  to that same channel. `/rides post` and `/rides sync` also require the rides channel, and
  `/rides ask-drivers` requires the driver channel.
- Everything is validated before anything is sent: type, churches, templates
  (`weeklyMessageTemplate` or `driverAskMessageTemplate`), one service week, and that
  `assignmentCompletedWeek` is not set for any listed church.
- **Re-running replaces the whole block.** For each church the new message goes live first, then
  the old one is deleted, and the old greeting is deleted too. For `post`, that week's
  `PENDING` ride requests become `CANCELLED` (rows are kept; reacting to the new post
  restores the same request). For `ask`, every driver's availability for the week is reset to
  FALSE. Reactions on deleted posts no longer count. Don't re-run after assignments have run.
- If anything is wrong, it posts nothing and replies with **every** problem at once, one line each,
  naming the church, the cell to fix, and what it found versus expected. IDs are shown as only
  their last four digits, for example `b: weeklyPostChannelId is …0000, but you ran this in a
  channel ending …4321`. An ID ending in `000` gets a hint that the cell was probably rounded
  (format the column as Plain text and re-enter it).
- It stops at the first church that fails and reports each church's result, with the Discord or
  HTTP error code when there is one.
- Google Sheets allows about 60 requests a minute, and a broadcast makes several per church. The
  Sheets layer retries rate limits (HTTP 429) with backoff, so a broadcast can take a minute or
  two. If a message is posted but the Sheet can't record it, the bot deletes that message again
  rather than leave a post the Sheet doesn't know about. If a run still reports a 429, wait a
  minute and re-run. Re-running is safe:
  it replaces what was posted and posts what wasn't.
- `/rides post` and `/rides ask-drivers` are unchanged: they still skip a church that already
  has this week's message.

## Saturday assignment Apps Script

The standalone script is [apps-script/Code.gs](../apps-script/Code.gs). In the
Sheet, choose **Extensions → Apps Script**, replace the default file with its
contents, save, and set the Apps Script project's timezone to the pilot churches'
shared local timezone. The script needs the six tabs and exact headers from the
setup instructions; `npm run setup:sheets` appends `Assignments.unassignedReason`.

To test it manually, seed two church IDs with shared `Zones`, separate `Members`,
available `Drivers`, and `PENDING` `RideRequests`. Set each request's `weekDate`
to the upcoming Sunday (`YYYY-MM-DD`) in that church's timezone. In the Apps Script
editor select `runSaturdayAssignments` and click **Run**; grant the Sheet and lock
permissions when prompted. The execution log reports each church and row count.
In `Assignments`, each pending rider gets one row for that church/week: seated
riders have a `driverId`, while overflow riders have a blank `driverId` and an
`unassignedReason`. Re-running preserves seated riders, frees a cancelled rider's
seat while retaining their `assignmentStatus = CANCELLED` history row, and tries
only newly pending or still-unassigned riders.

After the manual check, select `createSaturdayAssignmentTrigger` and click **Run**
once. It installs one Saturday trigger at approximately 11:45 AM in the project
timezone; Apps Script time triggers are approximate. Do not run it against live
data until the seeded two-church output is correct.

To add on-sheet controls, select `buildAllButtons` in Apps Script and click **Run**
once. It creates a `Buttons` tab containing **Run Assignments** and **Reset
Assignments**. The first preserves seated riders and fills only new/unassigned riders.
The reset button asks for confirmation, then deletes only each church's Assignment rows
for the current upcoming service Sunday; requests and every other week's rows remain.
Run `removeAssignmentButton` or `removeResetAssignmentsButton` from the Apps Script
function dropdown to remove either control without changing rows.

## Timing, replies and recovery

**Manual mode:** weekly state (`activeMessageId`, `activeWeekDate`, `availabilityResetWeek`,
and the driver ask IDs) lives in the Sheet and survives a restart. The bot does not run
the scheduler, post automatically, reset availability automatically, or send driver asks
automatically. It waits for an admin command. Use `/rides post church:ID` to create the
weekly post (rides channel), `/rides sync church:ID` to catch up reactions on both the ride
post and the driver ask (run it in either channel), and `/rides ask-drivers church:ID` (in the driver channel) to reset drivers and
post the ask. Both commands skip a church that already has this week's message; a
broadcast replaces it.

## Driver reactions and sign-up

Reacting to a church's current driver ask (any emoji) is how a driver opts in; removing the
reaction opts out. What happens depends on who reacts:

| Who reacts | Result |
|---|---|
| Active driver for this church | Marked available this week. |
| Driver an admin turned off (`isActive` FALSE) | Told "driver access is turned off"; nothing changes. |
| Drives for another church (active row there) | A Drivers row for this church is created with the same seats and home zone, `COMPLETE`, and they are marked available immediately. |
| Registered, not a driver anywhere | A **placeholder** Drivers row is created at once (`signupStatus` PENDING, **4 seats**, home zone from their profile, not available) and they get a DM with a **Set my seats** button. Submitting the form sets their real seats and marks the row `COMPLETE`, and grants the Drivers role. They react again to opt in. |
| Not registered | A PENDING member and a **placeholder** Drivers row (4 seats, name and zone blank, not available) are created, and a DM with **Start driver sign-up** opens the same survey as riders. Finishing it fills in the profile and the row (`COMPLETE`) and grants the role. They react again to opt in. |

Reacting again on a placeholder: a registered rider is marked available (on the placeholder seats, if they
have not set their own) and is DM'd to confirm their seats. Someone who has not finished registering is
**not** made available; they are prompted again. `canDrive` on the church's Members row is set to TRUE
whenever a Drivers row is created or completed for them.

- Removing a reaction as a non-driver does nothing and sends no message.
- If assignments have run (`assignmentCompletedWeek` is the current service Sunday), a new
  opt-in is refused with a message, including starting sign-up. Drivers already available can
  still opt out.
- `/rides sync` also reconciles the driver ask: reactors become available (or are offered
  sign-up), and drivers who opted in by reaction but no longer have one become unavailable.
  Availability you set by hand in the Sheet, with `respondedWeek` blank, is not overwritten.
  If the ask message was deleted, sync clears its ID so the ask can be posted again.
- Finishing sign-up needs `driverRoleId` set for the church and **Manage Roles** for the bot; if
  granting the role fails, the row stays a placeholder.
- **Before deploying this version, run `npm run setup:sheets`** to add `Members.canDrive` and
  `Drivers.signupStatus`. Without `signupStatus`, driver reactions fail with "Missing
  Drivers.signupStatus; run setup:sheets"; a missing `canDrive` is skipped silently. On startup the bot
  logs `SHEET SETUP NEEDED: missing ...` listing any missing columns.
- A broadcast `ask` replaces the post and resets every driver to unavailable, so reactions on
  the old post no longer count.

- Adding any reaction to the active weekly post creates a ride request; removing a
  reaction cancels it. Startup and `/rides sync` reconcile all emoji reactions,
  including paginated lists over 100 reactors. Re-registering does not itself create
  a ride request; react again afterward. The +1 feature is deferred.
- Saturday 10am is informational. The bot does not infer that an assignment ran
  merely because the clock passed 11:45. `assignmentCompletedWeek` closes new
  requests once the separate assignment pass completes. Cancellations
  stay available. Once assignments have run, a new driver opt-in is refused; this pass
  does not change `Assignments` or invoke autofill.

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
   and `/rides post church:church-b` in the shared channel. Each post has its own saved
   `activeMessageId`. React with any emoji to A as a new user: the reaction remains,
   a Church A **Start registration** button arrives by DM, and no request exists. Complete the survey
   with name, `+12025550123`, preferences, and a local zone; then react again to A.
   Expect one PENDING A request. React to B's post with the same account: expect an
   immediate B request using the same pickup location (and an internal B `Members`
   row). The registration confirmation is an
   ephemeral Discord response, not a welcome DM. Invalid survey data must not create a row.
2. **Post routing and cancellation:** re-run either church's `/rides post` command:
   expect no duplicate for that church. Remove your reaction from A: only A becomes CANCELLED.
   Re-add it: the same A request becomes PENDING. Reactions to unrelated or
   previous-week messages do nothing.
3. **Driver reactions:** run `/rides ask-drivers church:church-a` and then `church:church-b` in
   the driver channel: each church gets its own ask post and drivers start FALSE. With a
   seeded driver row for church A, react to A's ask: only A becomes TRUE; remove it: FALSE. React
   to B's ask: B has no row for you, but you drive for A, so B's row appears with A's seats and
   zone and is TRUE at once. With a fresh account that has no profile, react to A's ask: you get a
   **Start driver sign-up** DM and a PENDING placeholder Drivers row (4 seats, FALSE); react again
   before finishing and confirm it is still FALSE. Finish the sign-up and confirm the row is COMPLETE
   with your seats, the role exists, `canDrive` is TRUE and availability is still FALSE; react again:
   TRUE. With a rider-only account, react: a PENDING row with 4 seats appears and you get a
   **Set my seats** DM (0 or 25 is rejected); submit it, confirm the seats and COMPLETE, then
   react again: TRUE. A
   non-admin cannot run `/rides ask-drivers`; re-running it for the same week does nothing.
4. **Restart:** stop and start the bot. Confirm the Church rows keep their
   `activeMessageId`, `activeWeekDate` and driver ask IDs, and no post or driver ask occurs on
   its own. Run `/rides sync church:church-a`; confirm repeated syncs create no duplicate rows
   and that a reaction made while the bot was stopped is picked up, for both the ride post and
   the driver ask.
5. **Manual driver asks:** run `/rides ask-drivers church:church-a`; confirm drivers' availability
   is reset and one ask post appears. The configured schedule fields are retained for future
   automation but do not trigger actions in this manual mode.
6. **Tenant/stale protections:** react to an old-week driver ask or use another
   user's sign-up button: no write. Remove a test guild mapping after its posts have been sent:
   further events must not write under another church. Duplicate mappings must log
   an ambiguity and drop writes. Restore the valid Church rows afterward.
7. **Assignment boundary:** in church A only, manually set `assignmentCompletedWeek`
   to the current service Sunday. A fresh reaction must be refused; removing a
   reaction still cancels. B remains open. Clear this test marker afterward.
   With the marker set, a driver reacting to church A's ask is refused with a message, and an
   already-available driver can still opt out; verify that `Assignments` remains untouched.
8. **DM failure:** disable server DMs on a test user, then react to a weekly post.
   No registration or ride request is created. Re-enable DMs and retry the reaction;
   then react to the driver ask as a non-driver and confirm no sign-up is created while DMs are off.
9. **Broadcast:** add a `Broadcasts` row (`type` `post`, `churches` both test church IDs, a
   greeting with `{weekDate}`) and run `/rides broadcast name:<id>` in the shared channel as an
   admin. Expect the greeting, then church A's post, then church B's. React to both, then run
   it again: the first block disappears, a new block appears, both requests become CANCELLED,
   and a fresh reaction restores them. Repeat with `type` `ask` (drivers' availability resets
   to FALSE). A non-admin cannot run it.

Automated checks: `npm run typecheck` and `npm test` (Node's built-in test runner,
no Jest/Playwright infrastructure). They use in-memory Sheets/Discord doubles;
they do not authenticate, send real DMs or alter your live Sheet.

API references: [discord.js client](https://discord.js.org/docs/packages/discord.js/main/Client:Class),
[Google Sheets value writes](https://developers.google.com/workspace/sheets/api/guides/values).
