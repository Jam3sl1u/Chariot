# Chariot — agent working agreement

Chariot is the Discord + Google Sheets MVP defined in PRD §29
(`documentation/prd/Chariot_PRD_v2_3.md`). The README has the layout, commands and the MVP
requirement status table (MVP-000–009, tasks M.1–M.8). `docs/discord-bot.md` has setup and the manual
acceptance test. This file decides one thing: **when to just proceed, and when to stop and ask
James.**

## Source of truth

- Requirements: PRD §29 (MVP). Sections 1–28 are the future full build — do not implement them here
  unless James asks. The PRD is read-only for agents.
- Keep the README's requirement status table accurate: when you finish or change work on an MVP-xxx
  requirement or an M.x task, update its row in the same change.

## Tier 1 — proceed without asking

- Work that PRD §29 and `docs/discord-bot.md` fully specify: build it, test it, commit it.
- Routine implementation choices inside that spec — file layout, naming, helper extraction, test
  structure.
- Bug fixes and refactors that don't change product behavior.
- Anything reversible and contained to this repo (edits, local commits on a branch, local test runs).

## Tier 2 — stop and ask first

State the question plainly, specific enough to answer in one line ("the PRD doesn't specify X; A or
B, and why it matters"), and don't guess. Ask when:

1. **The PRD is ambiguous or silent** on a real product decision.
2. **A design fork has no PRD answer** — different data flow, library or UX behavior, not just an
   implementation detail. The assignment rules are one: the code prefers same housing, then distance,
   then zone priority, while PRD §29.2 says fixed zone priority.
3. **The change touches tenant isolation, schema/Sheet headers, or security** — the `churchId`
   scoping, the `activeMessageId` routing, credentials, or admin permission checks.
4. **It would change live data or shared state** — running seed/migrate scripts or Apps Script
   against the real Sheet, posting in the real Discord guild, or force-pushing.
5. **It needs a real-world account, purchase or credential** you can't supply (new bot token, Google
   Cloud project, SMS vendor).
6. **The same question has blocked the work twice.**

If one task is blocked, work on another unrelated one rather than stalling the whole session.

## Before you call work done

1. **Run the checks and show the output.** Run `npm run typecheck` and `npm test` and report the
   actual pass/fail counts. Don't say "tests should pass". If something wasn't run, say so.
2. **Tests don't touch live services.** The suite uses in-memory Sheets/Discord doubles. Claims about
   real Discord or Sheet behavior need the manual acceptance test in `docs/discord-bot.md`; say which
   parts you did or didn't run.
3. **Re-check Tier 2.** If you proceeded on an assumption that belonged there, stop, undo it and ask.
4. **Keep docs in step.** Update `docs/discord-bot.md` and the README status table when behavior,
   commands, or Sheet columns change.

## Safety

- Never commit `.env`, `service-account-key.json` or any token (both are gitignored).
- Don't print Discord IDs, member data or credentials in logs or output.
- Run one bot instance, and don't sort or delete Sheet data rows while it may be writing.
- Commit and push only when James asks.
