# 07 — API Specification

**Purpose / Read this when:** you add or change an endpoint, a server action that mirrors one, or a client call. Every service function has a REST route here; the OpenAPI document `docs/tech/openapi.yaml` is generated from the same Zod schemas and must match.

**Requirements covered:** SYS-019, SYS-022, SYS-009, SYS-012; every FR with an endpoint (cited per row); AI-002 (delegation stream).

## 1. Global conventions

| Topic | Rule |
|---|---|
| Base path | `/api/v1` (versioned by path; breaking changes go to `/api/v2` and the old version stays for one release) |
| Content types | Requests `application/json`; responses `application/json` except the delegation stream (`text/event-stream`) and exports (`application/json` with `Content-Disposition: attachment`) |
| Authentication | Session cookie (Better Auth) for browsers; `Authorization: Bearer <session token>` for scripts (token from `authClient.getSession()`); routes marked `cron` use `Authorization: Bearer <CRON_SECRET>`; `public` needs nothing |
| CSRF | Non-GET cookie-authenticated requests must send `X-Requested-With: tassl` (`08-auth-authz.md` §2.7) |
| CORS | Not enabled; same-origin only |
| Request ids | `x-request-id` honored if a UUID, else generated; returned on every response and in every error envelope |
| Errors | `{ "error": { "code", "message", "details?", "requestId" } }` with the status mapping in `10-backend-spec.md` §1; validation errors carry `details.issues[] = { path, message }` |
| Pagination | `?cursor=&limit=` (default 20, max 100); response `{ items: [...], nextCursor: string | null }`; sort `created_at desc, id desc` |
| Filtering and sorting | Only the documented query parameters; unknown parameters are rejected with `VALIDATION_ERROR` |
| Rate limits | Buckets `read` 600/min, `write` 60/min, `auth` 10/min, `llm` 10/min, `run-events` 300/min per user (D-026); `429` with `Retry-After` |
| Idempotency | `Idempotency-Key` header accepted on the routes marked *idempotent*; a repeat within 24 h returns the original result |
| Timeouts | Route `maxDuration` 60 s; 300 s for delegation, generation start, and the jobs drain |
| Caching | `Cache-Control: no-store` on every `/api/v1` response |
| Tenancy | Resources from another institution return `404` |
| Student views | Before scoring, never include warranted stances, evidence status, failure families, planted flags, verification results before the action, rationale, or the escalation response id; the student's own debrief and record reveal warranted stance, evidence status, and failure family per claim after scoring (PRD §7.14). The question bank, expected-answer notes, seed records, the general escalation reply, and other students' data are never included (`12-security.md` §8, D-117) |
| Run polling | `GET /runs/{id}` returns `ETag: "v<version>"` and `X-Run-Version` (version = event count); clients send `If-None-Match` and receive 304 when nothing changed, decided after timers materialize (D-123) |

Auth column legend below: **S** = any session; **Stu** = run owner (student); **Rev** = run/section reviewer (instructor or TA); **Ins** = section instructor; **CI** = course instructor; **Auth** = author on the package (instructor or scenario_author, or platform editor with author membership); **PL** = program lead; **Adm** = platform admin; **Cron** = cron secret; **Pub** = public. Rate column names the bucket. Errors column lists codes beyond the global ones (`UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `RATE_LIMITED`, `INTERNAL_ERROR`).

## 2. System

| Method and path | Purpose | Auth | Request | Response | Errors | Rate | Example |
|---|---|---|---|---|---|---|---|
| `GET /api/health` | Liveness (SYS-009) | Pub | — | `{ status: 'ok', version }` | — | none | `→ {"status":"ok","version":"3f2a9c1"}` |
| `GET /api/ready` | Readiness: DB and jobs schema (SYS-009) | Pub | — | `{ status: 'ready', checks: { db, jobs } }` or `503` | — | none | `→ {"status":"ready","checks":{"db":"ok","jobs":"ok"}}` |
| `GET` or `POST /api/internal/jobs/drain` | Drain queues and run daily maintenance (SYS-020); Vercel Cron calls GET, runbooks use POST (D-121) | Cron | — | `{ processed: { [queue]: number }, durationMs }` | `UNAUTHENTICATED` | none | `→ {"processed":{"score_run":1,"send_email":3},"durationMs":842}` |
| `GET /api/v1/openapi.yaml` | The OpenAPI 3.1 document (SYS-019) | Pub | — | `text/yaml` | — | read | — |
| `/api/auth/*` | Better Auth endpoints (sign-up, sign-in, sign-out, verification, reset, social, organization, session) | per Better Auth | per Better Auth | per Better Auth | per Better Auth | Better Auth's | see `08-auth-authz.md` |

## 3. Identity (`/api/v1/me`)

| Method and path | Purpose | Auth | Request | Response | Errors | Rate | Example |
|---|---|---|---|---|---|---|---|
| `GET /me` | Current user with memberships and capabilities | S | — | `MeView` | — | read | `→ {"id":"…","name":"Student One","email":"student1@tassl.local","platformRole":"none","memberships":[{"organizationId":"…","name":"Walkthrough University","role":"student"}],"activeOrganizationId":"…"}` |
| `PATCH /me` | Update profile (SYS-003) | S | `{ name }` | `MeView` | — | write | `{"name":"S. One"}` |
| `POST /me/export` | Data export (SYS-004) | S | — | file `UserExport` | `EXPORT_RATE_LIMITED` | auth | `→ {"exportedAt":"…","profile":{…},"runs":[…]}` |
| `DELETE /me` | Soft-delete account (SYS-004) | S | — | `204` | — | auth | — |
| `GET /me/assignments` | Student's assignments with latest run | S | `?cursor&limit` | `Page<StudentAssignment>` | — | read | `→ {"items":[{"assignmentId":"…","label":"Decision Run 1 (walkthrough)","isWalkthrough":true,"latestRun":{"id":"…","state":"scored","attemptNo":1}}],"nextCursor":null}` |
| `GET /me/runs` | Student's runs | S | `?cursor&limit&state?` | `Page<RunSummary>` | — | read | — |

## 4. Tenancy

| Method and path | Purpose | Auth | Request | Response | Errors | Rate | Example |
|---|---|---|---|---|---|---|---|
| `POST /institutions` | Create institution (admin) | Adm | `{ name, slug, programLeadEmail }` | `Institution` | `CONFLICT` (slug) | write | `{"name":"Walkthrough University","slug":"walkthrough","programLeadEmail":"instructor@tassl.local"}` |
| `GET /institutions` | My institutions | S | — | `Institution[]` | — | read | — |
| `GET /institutions/{orgId}` | Institution with settings | S (member) | — | `InstitutionView` | — | read | — |
| `PATCH /institutions/{orgId}/settings` | Plan label, default mapping | PL, Adm | `{ plan?, defaultMapping? }` | `InstitutionView` | `MAPPING_INVALID` | write | `{"defaultMapping":{"novice":1,"developing":2,"proficient":3,"professional":4}}` |
| `POST /institutions/{orgId}/invitations` | Invite by email (SYS-005) | Ins, PL | `{ email, role }` | `Invitation` | `INVITATION_EMAIL_MISMATCH` | write | `{"email":"student3@tassl.local","role":"student"}` |
| `POST /invitations/{invitationId}/accept` | Accept invitation | S | — | `Membership` | `INVITATION_EMAIL_MISMATCH` | write | — |
| `GET /institutions/{orgId}/agreements` | Data agreements (FR-234) | PL, Adm, Editor (own org rows) | — | `DataAgreement[]` | — | read | — |
| `POST /institutions/{orgId}/agreements` | Create agreement | PL, Adm | `DataAgreementInput` | `DataAgreement` | `AGREEMENT_PURPOSES_INVALID` | write | `{"counterparty":"Walkthrough University","permittedPlatformRoles":["tassl_scenario_editor"],"purposes":["scoring_audit"],"retentionDays":365,"documentReference":"DA-2026-01","signedAt":"2026-09-01T00:00:00Z"}` |
| `PATCH /agreements/{agreementId}` | Update or end agreement | PL, Adm | partial + `endsAt?` | `DataAgreement` | same | write | — |

## 5. Courses and assignments

| Method and path | Purpose | Auth | Request | Response | Errors | Rate | Example |
|---|---|---|---|---|---|---|---|
| `GET /institutions/{orgId}/courses` | List courses (FR-200) | S (member) | `?cursor&limit` | `Page<CourseSummary>` | — | read | — |
| `POST /institutions/{orgId}/courses` | Create course | Ins (org role instructor) | `CreateCourse` | `Course` | `MAPPING_INVALID` | write | `{"name":"Marketing Strategy Walkthrough","term":"2026-fall","outsideAiPolicy":"declared","defaultRunWeight":2.5}` |
| `GET /courses/{courseId}` | Course detail with sections and assignments | S (member of a section or org instructor/PL) | — | `CourseView` | — | read | — |
| `PATCH /courses/{courseId}` | Policy, weights, taught concepts (FR-205) | CI | `UpdateCoursePolicy` | `Course` | — | write | `{"outsideAiPolicy":"in_environment_only"}` |
| `POST /courses/{courseId}/mapping/preview` | Preview points changes (FR-206) | CI | `{ mapping }` | `MappingChangePreview` | `MAPPING_INVALID` | read | `→ {"affected":[{"runId":"…","pointsNow":2.667,"pointsAfter":2.5}]}` |
| `POST /courses/{courseId}/mapping` | Apply mapping change and recompute | CI | `{ mapping, confirm: true }` | `Course` | `MAPPING_CHANGE_UNCONFIRMED` | write | — |
| `POST /courses/{courseId}/sections` | Create section | CI | `{ name }` | `Section` | — | write | `{"name":"A"}` |
| `GET /sections/{sectionId}/members` | Roster (SYS-005) | Ins, PL | `?cursor&limit` | `Page<SectionMember>` | — | read | — |
| `POST /sections/{sectionId}/members` | Add org member to section by email | Ins | `{ email, role }` | `SectionMember` | `NOT_SECTION_MEMBER` (email not in org) | write | `{"email":"student1@tassl.local","role":"student"}` |
| `DELETE /sections/{sectionId}/members/{userId}` | Remove | Ins | — | `204` | `MEMBER_HAS_RUNS` | write | — |
| `POST /sections/{sectionId}/assignments` | Create assignment (FR-200) | Ins | `CreateAssignment` | `Assignment` | `PACKAGE_NOT_CONFIRMED`, `VARIANT_MISMATCH` | write | `{"label":"Auto-lock test run","packageVersionId":"…","variantId":"…","workingClockSeconds":120,"isWalkthrough":true}` |
| `GET /assignments/{assignmentId}` | Assignment with package and variant | S (section member) | — | `AssignmentView` | — | read | — |
| `PATCH /assignments/{assignmentId}` | Update configuration | Ins | `UpdateAssignment` | `Assignment` | `ASSIGNMENT_IN_USE` | write | `{"workingClockSeconds":1500}` |
| `GET /assignments/{assignmentId}/policy-display` | Policy display values (FR-201) | S (section member) | — | `PolicyDisplay` | — | read | `→ {"outsideAiPolicy":"declared","weight":2.5,"mapping":{…},"runType":"decision","workingClockSeconds":1500,"uncalibrated":true,"countsStatement":true}` |
| `GET /assignments/{assignmentId}/runs` | Runs on an assignment | Rev | `?cursor&limit` | `Page<RunReviewSummary>` | — | read | — |
| `GET /assignments/{assignmentId}/exports` | Export history (FR-184) | Rev | `?cursor&limit` | `Page<ExportSummary>` | — | read | — |
| `DELETE /runs/{runId}` | Delete a walkthrough run (D-104) | Ins | — | `204` | `FORBIDDEN` (not walkthrough) | write | — |

## 6. Scenario packages and authoring

| Method and path | Purpose | Auth | Request | Response | Errors | Rate | Example |
|---|---|---|---|---|---|---|---|
| `GET /institutions/{orgId}/packages` | Packages with latest version status and warnings | Auth, Ins, Editor | `?cursor&limit` | `Page<PackageSummary>` | — | read | — |
| `POST /institutions/{orgId}/packages` | Create package from seed (FR-190) | Auth | `CreatePackageFromSeed` | `{ packageId, versionId }` | `LICENSE_NOT_CONFIRMED`, `CONFLICT` (familyKey) | write (*idempotent*) | `{"title":"Halden Roastworks","familyKey":"halden-roastworks","conceptSet":["retention","payback","survey_error","ai_pushback"],"seed":{"caseTitle":"…","publisher":"…","licenseTerms":"…","licensePermitsAdaptation":true,"seedText":"…"}}` |
| `POST /institutions/{orgId}/packages/import` | Import a package JSON (SYS-026) | Auth | `PackageExport & { confirmOnImport }` | `{ packageId, versionId, validation }` | `IMPORT_INVALID`, `PACKAGE_INVALID` | write | — |
| `GET /packages/{packageId}` | Package with versions | Auth, Ins, Rev, Editor | — | `PackageView` | — | read | — |
| `GET /package-versions/{versionId}` | Package version view (FR-180, FR-195, FR-198) | Auth, Rev, Editor, PL (measures) | — | `PackageVersionView` | — | read | `→ {"id":"…","version":1,"status":"confirmed","calibrationStatus":"uncalibrated","confirmationRecord":[…],"authoringRecord":{…},"measures":{"seedToConfirmedMs":…,"editRate":0.18,"rejectedShare":0.04,"generationPasses":2,"reviewMsPerElement":41000},"warnings":[]}` |
| `GET /package-versions/{versionId}/export` | Package JSON | Auth, Rev, Editor | — | file `PackageExport` | — | read | — |
| `GET /package-versions/{versionId}/claims/{claimId}` | Claim object view (FR-180) | Auth, Rev, Editor | `?variantId?` | `ClaimObjectView` | — | read | `→ {"id":"…","key":"C3","text":"Premium payback is 11 months.","source":{"documentId":"…","title":"Positioning deck","datedOn":"2025-02-10","author":"…","passage":"…"},"states":[{"variantKey":"defective","evidenceStatus":"defective","failureFamily":"stale_evidence","warrantedStance":"verify","planted":true,"verificationPaths":{"source_trace":{…}}},{"variantKey":"sound",…}],"confirmation":{"decision":"confirmed","decidedBy":"…","decidedAt":"…"}}` |
| `PATCH /package-versions/{versionId}/elements/{elementType}/{elementId}` | Edit a draft element (FR-192) | Auth | element patch | element | `VERSION_FROZEN` | write | `{"body":"…"}` |
| `POST /package-versions/{versionId}/elements/{elementType}/{elementId}/decision` | Confirm or reject an element | Auth | `{ decision, note?, openedAt }` | `ElementConfirmation` | `VERSION_FROZEN` | write | `{"decision":"confirmed","openedAt":"2026-09-02T10:00:00Z"}` |
| `POST /package-versions/{versionId}/elements/{elementType}/{elementId}/regenerate` | Regenerate an element or set | Auth | `{ restatedRule? }` | `{ jobId }` | `VERSION_FROZEN`, `GENERATION_ALREADY_RUNNING` | llm | — |
| `POST /package-versions/{versionId}/confirm` | Confirm and freeze (FR-192) | Auth | `{ teachingNoteChecked: true }` | `PackageVersionView` | `ELEMENTS_UNCONFIRMED`, `TEACHING_NOTE_UNCHECKED`, `PACKAGE_INVALID` | write | — |
| `POST /package-versions/{versionId}/regenerate` | New draft version from this one (FR-195) | Auth | `{ reason }` | `{ versionId }` | — | write | — |
| `POST /package-versions/{versionId}/generation` | Start generation (AI-001) | Auth | — | `{ started: true }` | `SEED_MISSING`, `GENERATION_ALREADY_RUNNING`, `VERSION_FROZEN` | llm (*idempotent*) | — |
| `GET /package-versions/{versionId}/generation` | Generation status | Auth, Editor | — | `GenerationStatus` | — | read | `→ {"steps":[{"step":"documents","status":"succeeded","passNumber":1,"inputTokens":…}],"validation":{"ok":false,"failures":["NO_ACCEPT_WARRANTED_SOUND"]}}` |

## 7. Runs (student)

All routes require the run owner unless noted. Every response includes `run: RunSummary` with the current state, clock, and timers after `materializeTimers`.

| Method and path | Purpose | Auth | Request | Response | Errors | Rate | Example |
|---|---|---|---|---|---|---|---|
| `POST /assignments/{assignmentId}/runs` | Start a run (FR-231) | Stu (section student) | — | `RunSummary` | `RUN_ACTIVE_EXISTS` | write (*idempotent*) | `→ {"id":"…","state":"assigned","attemptNo":1,"isWalkthrough":true}` |
| `GET /runs/{runId}` | Run status, clock, timers (polled every 5 s) | Stu, Rev | — | `RunSummary` | — | read | `→ {"id":"…","state":"working","clock":{"remainingMs":1201000,"paused":false},"turn":null,"scoringStatus":"idle"}` |
| `POST /runs/{runId}/policy-ack` | Policy display acknowledged (FR-201) | Stu | — | `RunSummary` | `ILLEGAL_TRANSITION` | write | — |
| `GET /runs/{runId}/readiness` | Items and remaining time (FR-010) | Stu | — | `ReadinessView` | — | read | `→ {"expiresAt":"…","items":[{"id":"…","position":1,"category":"foundation","stem":"…","options":[{"key":"a","text":"…"}],"answerKey":null}]}` |
| `PUT /runs/{runId}/readiness/answers/{itemId}` | Answer an item | Stu | `{ answerKey }` | `204` | `CLOCK_EXPIRED` | run-events | `{"answerKey":"c"}` |
| `POST /runs/{runId}/readiness/submit` | Submit (FR-012) | Stu | — | `ReadinessResult` | — | write | `→ {"concepts":[{"conceptKey":"retention","status":"held"},{"conceptKey":"survey_error","status":"not_held"}]}` |
| `POST /runs/{runId}/readiness/skip` | Skip after failure (FR-018) | Stu | — | `ReadinessResult` | `READINESS_SKIP_NOT_ALLOWED` | write | — |
| `GET /runs/{runId}/workspace` | Full student workspace (FR-020) | Stu | — | `RunWorkspace` | — | read | — |
| `POST /runs/{runId}/documents/{documentId}/open` | Open a document (FR-022) | Stu | — | `{ openId, document: { id, key, title, author, datedOn, body } }` | `RUN_LOCKED` | run-events | — |
| `POST /runs/{runId}/document-opens/{openId}/close` | Close a document | Stu | — | `204` | — | run-events | — |
| `POST /runs/{runId}/frame` | Lock the frame (FR-040) | Stu | `LockFrame` | `RunSummary` | `FRAME_INVALID`, `ILLEGAL_TRANSITION` | write | `{"decision":"Whether premium economics justify moving spend from the value tier","assumptions":["Retention holds","Price sensitivity is low","Supplier cost is stable"],"position":"Lean toward holding spend","confidence":40}` |
| `POST /runs/{runId}/delegations` | Delegate to the assistant, streamed (FR-051, AI-002) | Stu | `{ request }` | `text/event-stream`: events `segment` (`{ type: 'text', text }` or `{ type: 'claim', claim: ClaimView }`), then `done` (`{ delegationId }`) | `ASSISTANT_LOCKED`, `ASSISTANT_REQUEST_TOO_LONG`, `ASSISTANT_UNAVAILABLE` (run paused), `LLM_BUDGET_EXCEEDED` | llm | request `{"request":"What is the premium payback?"}` |
| `GET /runs/{runId}/delegations` | Delegation Log (FR-060) | Stu, Rev | — | `DelegationView[]` | — | read | — |
| `PATCH /runs/{runId}/delegations/{delegationId}` | Why line, used marks (FR-060) | Stu | `{ why?, usedClaimIds? }` | `DelegationView` | `RUN_LOCKED` | run-events | `{"usedClaimIds":["…"]}` |
| `POST /runs/{runId}/outside-tool-declaration` | Declare outside-tool use (FR-061) | Stu | `{ purpose }` | `204` | — | write | `{"purpose":"Used a spreadsheet to recompute payback"}` |
| `GET /runs/{runId}/claims` | Claims with stances and actions (student view) | Stu | — | `ClaimView[]` | — | read | `→ [{"id":"…","key":"C3","text":"…","stance":"accept","previousStance":null,"actions":[],"availableActions":["source_trace"],"escalatable":true,"surfacedBy":"delegation"}]` |
| `PUT /runs/{runId}/claims/{claimId}/stance` | Set a stance (FR-080) | Stu | `{ stance }` | `ClaimView` | `CLAIM_NOT_SURFACED`, `RUN_LOCKED`, `RUN_PAUSED` | run-events | `{"stance":"challenge"}` |
| `POST /runs/{runId}/claims/{claimId}/actions` | Run an interrogation action (FR-070) | Stu | `{ type }` | `ActionResult` | `ACTION_NOT_AVAILABLE`, `CLOCK_EXPIRED` | write | `{"type":"source_trace"}` → `{"actionId":"…","clockCostMs":60000,"result":{"documentId":"…","title":"Positioning deck","datedOn":"2025-02-10","author":"…","passage":"…"}}` |
| `POST /runs/{runId}/claims/{claimId}/escalation` | Escalate (FR-090) | Stu | `{ statement }` | `EscalationResult` (student form: `responseText`, `clockCostMs`, `remainingEscalations`; `responseId` and `countsAgainstLimit` appear only in the replay, D-116) | `ESCALATION_LIMIT_REACHED`, `ESCALATION_STATEMENT_INVALID` | write | `{"statement":"I cannot tell whether this cohort comparison was actually computed."}` → `{"responseText":"…","clockCostMs":300000,"remainingEscalations":1}` |
| `PUT /runs/{runId}/brief` | Save brief draft (FR-100) | Stu | `BriefDraft` | `204` | `RUN_LOCKED` | run-events | — |
| `POST /runs/{runId}/brief/signals` | Brief opened/closed timing | Stu | `{ opened: true } | { closed: true, durationMs }` | `204` | — | run-events | — |
| `POST /runs/{runId}/lock` | Decision Lock (FR-084, FR-102) | Stu | `Brief` | `RunSummary` (`turnDueAt`) | `LOCK_REFUSED_UNSTANCED_CLAIM` (details `{ claimId, claimText }`), `BRIEF_INVALID`, `RUN_PAUSED` | write | `→ 409 {"error":{"code":"LOCK_REFUSED_UNSTANCED_CLAIM","message":"A claim you relied on has no stance.","details":{"claimId":"…","claimText":"Premium payback is 11 months."},"requestId":"…"}}` |
| `POST /runs/{runId}/addendum` | Add the 50-word addendum (FR-107) | Stu | `{ text }` | `204` | `ADDENDUM_EXISTS` | write | — |
| `POST /runs/{runId}/resume` | Resume from Paused (FR-001) | Stu | — | `RunSummary` | `ILLEGAL_TRANSITION` | write | `→ {"state":"working","clock":{"remainingMs":…,"creditedMs":300000}}` |
| `GET /runs/{runId}/turn` | Turn message and window (FR-110) | Stu | — | `TurnView` | `TURN_NOT_OPEN` | read | `→ {"text":"…","voice":"stakeholder_message","windowEndsAt":"…","windowClaims":[…],"frozen":{"frame":{…},"brief":{…}}}` |
| `POST /runs/{runId}/turn/response` | Hold, revise, or reverse (FR-112) | Stu | `TurnResponse` | `RunSummary` | `TURN_NOT_OPEN`, `TURN_CLAIMS_UNSTANCED` | write | `{"response":"revise","justification":"…","confidence":60}` |
| `GET /runs/{runId}/defense` | Open or resume the defense (FR-120) | Stu | — | `DefenseView` | `DEFENSE_NOT_OPEN` | read | `→ {"questions":[{"runQuestionId":"…","seq":1,"kind":"provenance","text":"Where did the 11-month payback come from?","answered":false,"followUpOf":null}],"artifacts":{"frame":{…},"brief":{…},"turnResponse":{…}}}` |
| `POST /runs/{runId}/defense/questions/{runQuestionId}/answer` | Answer (FR-124) | Stu | `DefenseAnswer` | `{ next: DefenseQuestion | null, followUp: DefenseQuestion | null }` | `QUESTION_ALREADY_ANSWERED` | write | `{"text":"From the assistant; I did not check the date.","durationMs":42000}` |
| `POST /runs/{runId}/defense/complete` | Complete the defense (FR-120) | Stu | — | `RunSummary` (`scoringStatus: 'queued'`) | `DEFENSE_INCOMPLETE` | write | — |
| `GET /runs/{runId}/debrief` | Debrief (FR-150) | Stu, Rev | — | `DebriefView` | `DEBRIEF_NOT_AVAILABLE` | read | — |
| `POST /runs/{runId}/debrief/answers` | The two questions (FR-152) | Stu | `DebriefAnswers` | `RunSummary` | `DEBRIEF_ANSWERED` | write | `{"stanceToChange":"I would have traced C3 before accepting it.","doDifferently":"Read the retention memo before the deck."}` |
| `GET /runs/{runId}/trace` | Events in order (FR-007) | Stu, Rev | — | `TraceEvent[]` | — | read | — |
| `GET /runs/{runId}/record` | Judgment Record (FR-170) | Stu | — | `RecordView` | `RECORD_NOT_AVAILABLE` | read | — |
| `GET /runs/{runId}/record/export` | Record-form trace file (FR-243) | Stu | — | file `TraceExport` | `RECORD_NOT_AVAILABLE` | read | — |

## 8. Review (faculty)

| Method and path | Purpose | Auth | Request | Response | Errors | Rate | Example |
|---|---|---|---|---|---|---|---|
| `GET /review/queue` | Illustrative queue plus real scored runs (FR-186, D-096) | Rev | — | `{ illustrative: QueueRow[], runs: RunReviewSummary[] }` | — | read | — |
| `GET /review/sections/{sectionId}/runs` | Runs in a section with decision progress | Rev | `?cursor&limit&state?` | `Page<RunReviewSummary>` | — | read | — |
| `GET /review/runs/{runId}` | Replay bundle (FR-180) | Rev | — | `ReplayBundle` | — | read | `→ {"run":{…},"events":[…],"graphs":{"confidence_line":{…},"clock_timeline":{…},"stance_matrix":{…},"frame_beside_decision":{…}},"defense":[…],"bands":[…],"readiness":[…],"package":{…},"claims":[…],"declarations":[…],"unverifiedNumbers":[…],"labels":{"uncalibrated":true},"capabilities":{"canDecide":true,"canVoid":true,"canNeutralize":true,"canForceFailure":true}}` |
| `PUT /review/runs/{runId}/bands/{dimension}` | Confirm, override, or set unassessed (FR-181) | Rev (TA limits) | `BandDecision` | `{ band: BandView, run: RunSummary }` | `BAND_DECISION_INVALID`, `RUN_NOT_SCORED`, `BAND_LOCKED_BY_INSTRUCTOR` | write | `{"decision":"overridden","band":"developing","note":"A wider net is defensible when information is thin."}` |
| `POST /review/runs/{runId}/confirm-remaining` | Confirm all undecided with their drafts | Rev | — | `RunSummary` | `RUN_NOT_SCORED` | write | — |
| `POST /review/runs/{runId}/manual-bands` | Band a held run manually (FR-140) | Rev | `{ bands: { [dimension]: band | 'unassessed' } }` | `RunSummary` | `RUN_NOT_SCORABLE` | write | — |
| `POST /review/runs/{runId}/void` | Void and optionally re-offer (FR-002) | Ins | `{ reason: 'unscoreable'|'scoring_held'|'walkthrough'|'other', note?, reoffer, variantId? }` (D-120) | `{ voided: RunSummary, reoffered: RunSummary | null }` | `ILLEGAL_TRANSITION` | write | `{"reason":"walkthrough","note":"auto-lock test run","reoffer":true}` |
| `POST /review/runs/{runId}/claims/{claimId}/neutralize` | Neutralize in both directions (FR-003) | Ins | `Neutralize` | `{ recompute: RecomputeResult, run: RunSummary }` | `NEUTRALIZATION_EXISTS` | write | `{"reason":"unintended_defect","creditChallenge":false,"note":"Document D4 contradicts D2 unintentionally."}` → `{"recompute":{"dimensions":["verification","calibration"],"bandsBefore":{"calibration":"developing"},"bandsAfter":{"calibration":"proficient"},"pointsBefore":2.286,"pointsAfter":2.429,"pointsEffective":2.429}}` |
| `POST /review/runs/{runId}/test-controls/force-assistant-failure` | Arm the forced failure (FR-118) | Ins | — | `{ armed: true }` | `TEST_CONTROLS_DISABLED` | write | — |
| `POST /review/runs/{runId}/delegations/{delegationId}/flag` | Flag out-of-scenario content (FR-055) | Rev | `{ flag: 'out_of_scenario' }` | `DelegationView` | — | write | — |
| `GET /runs/{runId}/exports` | Export versions (FR-184) | Rev | — | `ExportSummary[]` | `RUN_NOT_CONFIRMED` | read | — |
| `GET /runs/{runId}/exports/{version}` | Download course export (`latest` allowed) (FR-204) | Rev | — | file `TraceExport` (course form) | `EXPORT_NOT_FOUND` | read | — |

## 9. Notifications and admin

| Method and path | Purpose | Auth | Request | Response | Errors | Rate | Example |
|---|---|---|---|---|---|---|---|
| `GET /notifications` | List (SYS-010) | S | `?cursor&limit&unread?` | `Page<Notification>` | — | read | — |
| `POST /notifications/{id}/read` | Mark read | S | — | `204` | — | write | — |
| `POST /notifications/read-all` | Mark all read | S | — | `204` | — | write | — |
| `GET /admin/users` | Users (SYS-006) | Adm | `?cursor&limit&q?` | `Page<AdminUser>` | — | read | — |
| `PUT /admin/users/{userId}/platform-role` | Set platform role | Adm | `{ role }` | `AdminUser` | `ROLE_INVALID` | write | `{"role":"tassl_scenario_editor"}` |
| `GET /admin/flags` | Flags and effective provider | Adm | — | `{ ai, sampleData, testControls, effectiveLlmProvider }` | — | read | — |
| `GET /admin/audit-log` | Audit log | Adm | `?cursor&limit&orgId?` | `Page<AuditEntry>` | — | read | — |

Test-only (`APP_ENV=test`, excluded from OpenAPI, D-109): `POST /api/v1/test/runs/{runId}/advance-clock { ms }` → `RunSummary`.

## 10. Schemas

All schemas are Zod objects in the modules' `schema.ts` and appear in `openapi.yaml` under `components.schemas`. Key shapes:

- `RunSummary`: `{ id, assignmentId, attemptNo, state, mode, variantKey, isWalkthrough, clock: { remainingMs, paused, creditedMs, chargedMs } | null, turn: { dueAt, windowEndsAt } | null, scoringStatus, timestamps: { policyDisplayedAt, workingStartedAt, decisionLockedAt, turnDeliveredAt, turnLockedAt, defenseCompletedAt, scoredAt, confirmedAt, recordedAt, voidedAt }, links: { next: string } }`.
- `RunWorkspace`: `{ run, brief: { text }, documents: DocumentSummary[], openDocuments: OpenDocument[], frame: Frame | null, delegations: DelegationView[], claims: ClaimView[], briefDraft: BriefDraft, addendum, declarations: string[], pause: { cause, pausedAt } | null, turn: TurnView | null, capabilities }`.
- `ClaimView` (student): `{ id, key, text, surfacedBy, surfacedAt, inTurnWindow, stance, previousStance, stanceSetAt, actions: ActionResult[], availableActions, escalatable, escalation: EscalationResult | null, usedMarked, reliedOn }`.
- `Graph` payloads: `11.1` in `10-backend-spec-modules.md`.
- `BandView`: `{ dimension, draft: { band, status, reason, basis, provisional, graphKeys, evidenceEventSeqs, quotes, rationale }, decision: { decision, band, note, decidedBy, decidedAt } | null, effectiveBand, correction: { before, after } | null }`.
- `DebriefView`: sections in order with `available` flags; `bands: BandView[]`; `points: { mapping, weight, draft: number | null, confirmed: number | null }`; `questions: { answered, stanceToChange, doDifferently }`; `doneWell`.
- `ReplayBundle`: as in §8 example.
- `PackageVersionView`, `ClaimObjectView`, `GenerationStatus`, `PackageExport`: `10-backend-spec-modules.md` §4–5.
- `TraceExport`: `10-backend-spec-modules.md` §10.

## 11. Server Actions mirror

Every mutation above has a Server Action in the module's `actions.ts` with the same input schema and the same error codes, named after the service function (`lockFrameAction`, `setStanceAction`, …). The delegation stream is consumed from the client through the route (`fetch` + `EventSource`-style reader), not an action.
