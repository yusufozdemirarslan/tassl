# Incident: <title>

**How to use this file:** copy it to `docs/incidents/YYYY-MM-DD-<slug>.md` in the first three minutes
(`12-security.md` §9.3 step 1) and open a GitHub issue with the label `incident` assigned to the
incident lead. Fill the header now, the timeline as you go, and everything below it before the
post-incident review. The record is kept for the life of the project.

Evidence files (`incident-logs.txt`, `incident-audit.csv`, exported rows, screenshots) live beside
this file and are **never committed** — `.gitignore` keeps them out. Never paste a secret value, a
connection string, a session token, or another person's authored text into this record.

---

| Field           | Value                                                          |
| --------------- | -------------------------------------------------------------- |
| Severity        | SEV1 / SEV2 / SEV3 / SEV4 (`12-security.md` §9.1)              |
| Status          | open / contained / closed                                       |
| Detected at     | `YYYY-MM-DDTHH:MM:SSZ` (UTC)                                    |
| Detected by     | alert name, person, or report                                   |
| Incident lead   |                                                                 |
| Scribe / second |                                                                 |
| GitHub issue    | #                                                               |
| Deployment      | deployment id from `npx vercel@59.11.2 ls tassl --prod`          |
| Release         | git SHA                                                         |

## Summary

Two or three sentences: what happened, who was affected, what state things are in now. Describe
behaviour and data, never intent — the no-accusation rule of FR-006 applies to this record too.

## Timeline (UTC)

| Time | Who | What happened / what was done |
| ---- | --- | ----------------------------- |
|      |     |                               |

Start with detection and keep appending as the incident runs; the first 30 minutes follow
`12-security.md` §9.3 (open the record, capture, contain, preserve evidence, decide disclosure).

## Scope

- Tables and rows touched:
- Run ids / user ids / organizations affected:
- Time window (UTC):
- What an unauthorized party could have seen (answer keys count as student-impacting):
- What could have been changed:

## Containment

Which class of §9.3 step 3 this was and what was run:

- [ ] Leaked secret rotated (`12-security.md` §9.4, `13-observability-ops.md` §8.5) — name and date only, never the value
- [ ] Deployment rolled back (`13-observability-ops.md` §8.2)
- [ ] Data restored (`13-observability-ops.md` §8.4) — restore timestamp agreed in this record first
- [ ] Sessions revoked (`pnpm exec tsx scripts/revoke-sessions.ts --email <address>` or `--all`)
- [ ] `FEATURE_AI` / `FEATURE_TEST_CONTROLS` set to `false`
- [ ] Route disabled or fixed forward

## Evidence captured

Files kept beside this record (not committed), Sentry issue links, request ids, log queries.

## Root cause

What actually happened, at the level of the code or the configuration. Written after containment, not
during it.

## Student and institution impact

- Bands or scoring affected: (bands never go down, FR-005; neutralize with `misbehaving_material`
  where answer keys were exposed before scoring, FR-003)
- Runs voided or re-offered:
- Nothing here is a misconduct finding (FR-006).

## Disclosure decision (`12-security.md` §9.5)

| Question                                         | Answer |
| ------------------------------------------------ | ------ |
| Was identity data or authored text exposed?       |        |
| Institution contact notified (who, when, how)?    |        |
| Affected users notified (`incident-notice` email)? |        |
| Notice text (verbatim) and send time              |        |
| If not notified, why                              |        |

The decision is recorded either way, and before minute 30 for a SEV1.

## Follow-ups

| # | Action | Owner | PR / issue | Done |
| - | ------ | ----- | ---------- | ---- |
| 1 | The test that would have caught this |  |  |  |
| 2 | `DECISIONS.md` row if a rule changed |  |  |  |

Post-incident review within five working days of closing.
