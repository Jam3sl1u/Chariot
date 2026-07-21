# Chariot Build Checklist (Verifier Acceptance Criteria)

Source of truth: [`documentation/Chariot_PRD_v1.3.md`](../documentation/Chariot_PRD_v1.3.md) ("the
PRD"). This file is NOT a PRD-completeness checklist — the PRD is already complete and is the fixed
input spec. This is a **build checklist**: every row is an implementation increment, derived from
the PRD's own Build Order (§18), expanded into concrete units of work small enough to plan → build
→ test → commit → push in one turn.

**This file is a derived index, not the ground truth.** It was built by reading the PRD once and
grouping its requirement IDs into buildable rows — that grouping can itself contain errors (it
already did once: row 07 originally mis-cited BE-008–BE-015 as algorithm-core when they're actually
the Scheduled Jobs IDs, and MC-001–006/NFR-001–004 were missing entirely until this revision). If
anything you read directly in the PRD doesn't match what a row here claims, **the PRD wins** —
fix this file's row description and keep going; don't silently build against a stale paraphrase.
Row 45 exists specifically as a full-coverage backstop against exactly this class of drift.

Ordering matters. Rows are listed in dependency order — do not start row N+1 until every row it
depends on is Done (see the Depends-on column). Within a phase, rows may be built in any order
relative to each other unless a Depends-on reference says otherwise.

Each row lists the exact PRD requirement IDs it must satisfy. Before building, **read those
requirement rows in the PRD itself** (search the ID, e.g. `BE-016`) — the literal PRD text is the
acceptance criteria, not this one-line summary. A row is only **Done** when every requirement ID it
lists is implemented exactly as the PRD states it, has passing test coverage per §12, and the
verifier profile has independently re-read the PRD text (not this file) and confirmed the diff
matches it.

## Phase 0 — Kickoff

- [ ] 00 Submit Telnyx Toll-Free Verification — **human action, not code**. 4–8 week lead time; the
      single highest-leverage day-one action per the Risk Register (§19, Risk #1). Log as an
      escalation immediately; do not let it block any other row.
- [ ] 01 Monorepo scaffold — `/apps/web`, `/apps/bot`, `/packages/db`, `/packages/types` per §2.1/2.4;
      base tooling (TS config, lint/format, package manager workspaces).
- [ ] 02 Neon Postgres provisioned + Prisma bootstrapped + base NextAuth login shell (WEB-003/004
      partial — full auth completed in row 20).

## Phase 1 — Core Data + Algorithm (depends on Phase 0)

- [ ] 03 Full Prisma schema — every model in §2.3: `Church` (including `estimatedTravelTimeMinutes`,
      new in v1.3), `PickupPoint` (no `isChurchNode` row — removed in v1.3), `PickupPointDistance`
      (no `driveSeconds` field — removed in v1.3), `StandingRideRequest`, `Member`, `MemberChurch`,
      `AdminChurch`, `Driver`, `RideRequest`, `PlusOne`, `RideAssignment`, `SpecialRequest`,
      `WeeklyStatus`, `NotificationLog`. Also covers the schema-level multi-church requirements
      (§3): every Church row is self-sufficient and per-church settings/registry live on it.
      Requirement IDs: DB-001–DB-015, MC-001, MC-004, MC-006.
- [ ] 04 Tenant isolation Prisma middleware/client extension (§2.7) — app-layer `churchId` scoping
      on every table, no native RLS. Requirement IDs: MC-002, MC-007, MC-008. Test IDs: TEST-012,
      TEST-013, TEST-013a.
- [ ] 05 Nominatim geocoding + `geo-tz` timezone lookup integration (§2.9.2). Requirement IDs:
      BE-029, BE-030.
- [ ] 06 **Local pickup-point distance computation (no external API — Google Distance Matrix was
      removed in v1.3).** Haversine-formula distance calculation between `PickupPoint`s (§2.9.3),
      triggered on registry change, plus seeding the pilot church's initial 19-point registry and
      full pairwise distance set directly from `documentation/seed-data/pickup_points.csv` and
      `pickup_point_pairs.csv` (do not recompute these via the formula — load them as-is so the
      seeded values match the provided source exactly; only points added *after* seeding compute
      via the formula). Requirement IDs: BE-031, BE-032, BE-033. (OPS-008, previously assigned to
      this row for Google API cost-logging, is removed in v1.3 — nothing left to log.) Depends on
      row 05 (needs geocoded points for any future additions beyond the seeded 19).
- [ ] 07 Detour-cost assignment algorithm core (§7.1) — simultaneous multi-driver placement,
      pre-clustering, tolerance chain re-check, stop-order sequencing. **v1.3: detour cost reduces
      to plain pairwise distance** (`distance(A → B)`) since the church-distance terms cancel — see
      §7.1's worked explanation before implementing; do not implement the original v1.1
      `distance(B→church) − distance(A→church)` terms literally, they no longer apply. Requirement
      IDs: BE-001–BE-007, BE-016–BE-024. (BE-008–BE-015 are the Scheduled Jobs section, §7.2 — see
      row 15, not this row; BE-025–BE-036 belong to later rows.) Test IDs: TEST-001, TEST-030,
      TEST-031, TEST-032, TEST-033. Depends on row 06 (needs the distance matrix to compute detour
      cost).
- [ ] 08 Algorithm regression-snapshot harness + CI merge gate (§12.6). Test IDs: TEST-028, TEST-029.
      Depends on row 07.

## Phase 2 — Discord Bot (depends on Phase 1; parallel with Phase 3)

- [ ] 09 Bot process scaffold — event wiring, per-minute master cron, `luxon`-based per-church
      scheduling (§2.4), bot resolves the correct church from the incoming Discord guild ID on
      every event (§3). Requirement IDs: MC-003.
- [ ] 10 `/register` slash command flow (§4.1). Requirement IDs: BOT-001–BOT-009.
- [ ] 11 Web signup flow (§4.1) — shares backend with row 10. Requirement IDs: WEB-A01–WEB-A08.
- [ ] 12 Weekly ride post + ✅/1️⃣ reactions (§4.2). Requirement IDs: BOT-010–BOT-021.
- [ ] 13 Driver availability ask + YES/NO parsing (§4.3). Requirement IDs: BOT-022–BOT-030.
- [ ] 14 Standing (recurring) ride request auto-renewal job (§2.4, §5.2.2). Requirement IDs: BE-025,
      WEB-079, WEB-080, WEB-081. Test IDs: TEST-034. Depends on row 03.
- [ ] 15 Scheduled jobs: `resetAvailability`, `weeklyPost`, `driverAvailabilityAsk`,
      `memberReminder`, `assignRides`, `notifyDrivers`, `notifyMembers` (§7.2). Requirement IDs:
      BE-008–BE-015, BE-026. Depends on rows 07, 12, 13, 14.
- [ ] 16 Telnyx SMS integration — outbound send, inbound webhook, idempotency, STOP handling
      (§2.9.1). Requirement IDs: BE-027, BE-028. Test IDs: TEST-009, TEST-025, TEST-027.
- [ ] 17 Notification channel-selection logic + fan-out, all message types (§8). Requirement IDs:
      NOTIF-000a–d, NOTIF-001–NOTIF-020. Test IDs: TEST-004. Depends on rows 15, 16.
- [ ] 18 Bot-offline mitigations — startup reconciliation, `/rides sync`, `GET /health` (§2.6).
      Requirement IDs: BOT-013. Test IDs: TEST-011, TEST-019.
- [ ] 19 `/rides ...` Discord command reference (§5.4). Requirement IDs: WEB-069–WEB-075.

## Phase 3 — Web Application (depends on Phase 1; parallel with Phase 2)

- [ ] 20 Auth — login, first-login password set, forgot-password OTP, session scoping/expiry (§5.1).
      Requirement IDs: WEB-001–WEB-011. Test IDs: TEST-002, TEST-016.
- [ ] 21 Member portal — church groups, ride status, +1, cancellation (§5.2.1–5.2.2). Requirement
      IDs: WEB-012–WEB-023. Test IDs: TEST-007.
- [ ] 22 Standing requests + ride history in the member portal (§5.2.2). Requirement IDs: WEB-079,
      WEB-081, WEB-086. Depends on row 14.
- [ ] 23 Member profile, incl. Google Calendar connect entry point (§5.2.3). Requirement IDs:
      WEB-024–WEB-030, WEB-084, WEB-085. (OAuth mechanics land in Phase 4 — this row is the profile
      UI and the non-Calendar fields.)
- [ ] 24 Special requests — member side (§5.2.4). Requirement IDs: WEB-031–WEB-034.
- [ ] 25 Admin dashboard overview + "This Week" management (§5.3.0–5.3.1). Requirement IDs:
      WEB-035–WEB-051, WEB-087, WEB-088. Test IDs: TEST-005 (all 7 capacity scenarios).
- [ ] 26 Waitlist auto-fill + reassignment notice (§5.3.1, §8.8). Requirement IDs: WEB-083,
      NOTIF-019. Test IDs: TEST-036. Depends on row 25.
- [ ] 27 Admin member management (§5.3.2). Requirement IDs: WEB-052–WEB-056, WEB-080.
- [ ] 28 Admin driver management (§5.3.3). Requirement IDs: WEB-057–WEB-060.
- [ ] 29 Admin special request inbox (§5.3.4). Requirement IDs: WEB-061–WEB-063.
- [ ] 30 Admin stats & history (§5.3.5). Requirement IDs: WEB-064–WEB-066.
- [ ] 31 Church settings + super-admin onboarding + PickupPoint registry management (§5.3.6).
      Requirement IDs: WEB-067, WEB-068, WEB-076, WEB-082, MC-005. Test IDs: TEST-018, TEST-039.
      Depends on rows 05, 06 (registry edits geocode + recompute the distance matrix).
- [ ] 32 Admin assignment — admin-to-church role management, super-admin only (§5.3.7). Requirement
      IDs: WEB-072–WEB-074.
- [ ] 33 Full API route surface (§5.5) — build out any route not already covered by rows 20–32 (auth,
      public signup, portal, admin, inbound webhooks). Cross-check every route in §5.5 exists.
- [ ] 34 Key screens per the wireframe descriptions (§5.3.8) — apply the described layouts across
      rows 20–32's pages.

## Phase 4 — Google Calendar Sync (depends on Phase 3)

- [ ] 35 Google Calendar OAuth flow (§2.9.4). Requirement IDs: WEB-084, WEB-085.
- [ ] 36 Calendar event create/update/delete lifecycle, tied to `RideAssignment` changes (§2.9.4).
      Requirement IDs: BE-034, BE-035, BE-036, DB-015. Test IDs: TEST-037.
- [ ] 37 Refresh-token encryption at rest (§17.1). Requirement IDs: SEC-011. Test IDs: TEST-040.

## Phase 5 — Integration & Testing (depends on Phases 2, 3, 4)

- [ ] 38 Complete remaining Jest unit/integration coverage not already landed alongside its feature
      row (§12.1). Requirement IDs: TEST-002, TEST-003, TEST-006, TEST-008, TEST-010, TEST-035.
- [ ] 39 Full Playwright E2E suite (§12.3). Test IDs: TEST-014, TEST-015, TEST-017, TEST-018,
      TEST-038, TEST-039.
- [ ] 40 Load testing via Artillery (§12.4), and confirm the performance requirements it's meant to
      validate (§15.1). Test IDs: TEST-020, TEST-021, TEST-022. Requirement IDs: NFR-001, NFR-002,
      NFR-004.
- [ ] 41 Security testing pass (§12.5, §17.3). Requirement IDs: SEC-007, SEC-008, SEC-009, SEC-010.
      Test IDs: TEST-023, TEST-024, TEST-026.
- [ ] 42 CI/CD pipeline (§16.2) — GitHub Actions running Jest on every PR, Playwright against preview
      before merge to `main`, auto-deploy on merge, documented rollback. Requirement IDs:
      OPS-001–OPS-004.
- [ ] 43 Monitoring & observability (§16.4) — UptimeRobot health checks, error tracking (e.g. Sentry
      free tier), `NotificationLog` audit trail exposed on the stats page, and confirm the 99%
      uptime target (§15.3) is a monitored reality, not just an aspiration. Requirement IDs:
      OPS-005, OPS-006, OPS-007, NFR-003.
- [ ] 44 Data security & compliance pass (§17.1–17.2). Requirement IDs: SEC-001–SEC-006.
- [ ] 45 **Full requirement-ID cross-check.** Grep the PRD for every ID pattern (`BOT-`, `WEB-`
      including `WEB-A`, `BE-`, `DB-`, `MC-`, `NOTIF-`, `SEC-`, `OPS-`, `TEST-`, `NFR-`), build the
      complete list, and confirm every single ID is (a) implemented, (b) covered by the test IDs
      §12 assigns to it, and (c) actually referenced by some row in this checklist. Any ID found
      unimplemented or untested at this point is a real gap this checklist's own row-grouping
      missed — fix the gap (build it, or get an explicit human-confirmed Skip per GOAL.md working
      rule 6) before Phase 6. Do not treat "every row above is Done" as sufficient on its own; this
      row is the independent check that the row-grouping itself didn't drop anything.

## Phase 6 — Pilot Launch (depends on Phase 5 + Telnyx verification approved, row 00)

- [ ] 46 Onboard the pilot church per the Migration & Onboarding Plan (§21) — settings, PickupPoint
      registry (19 locations), manual member/driver re-entry, announce switch.
- [ ] 47 Run one full week in parallel with the pilot church's existing spreadsheet; compare output,
      confirm routes make sense, then retire the spreadsheet.

## Phase 7 — Multi-Church Rollout (depends on Phase 6)

- [ ] 48 Onboard the remaining handful of churches (§15.2 — target 2–5 total) once the pilot runs
      clean for one full week.

## Priority-first flags (per the PRD's own Risk Register, §19)

Among anything still Missing, protect these first — they're the schedule's critical path or the
biggest failure-mode risk:
- Row 00 (Telnyx TFV) — 4–8 week lead time, start immediately, never let it silently stall.
- Row 07 (detour-cost algorithm) — the single largest net-new build surface (Risk #2); if behind by
  Phase 5, the PRD's own fallback is to ship straight-line-distance-only and fast-follow real
  routing distance, rather than slipping launch.
- Row 04 (tenant isolation middleware) — no DB-level backstop exists (Risk #7); TEST-008/012/013
  are the only safety net.
- Row 45 (full requirement-ID cross-check) — never skip this even under time pressure; it's the
  only row whose entire job is confirming the rest of the build actually matches the PRD.
