# 10 — Backend Specification: Modules

**Purpose / Read this when:** you implement or change a domain module. Each section lists the module's responsibilities, the entities it owns, its service functions with signatures and business rules (traced to FR-###), its repository functions, validation schemas, the events it emits, its error codes, and edge cases. Cross-cutting patterns are in `10-backend-spec.md`.

**Requirements covered:** FR-001 to FR-254 (build-slice rows), AI-001 to AI-005, SYS-001 to SYS-028, DATA-001 to DATA-055.

Notation: `Actor` = the session user with resolved roles; all service functions take `actor` first; `tenantId` is derived from the resource and checked, never trusted from input. Types come from the module's `schema.ts`. Every function that writes appends the listed events inside its transaction (`10-backend-spec.md` §6).

## 1. `identity`

**Responsibilities.** Current user, profile, account settings, data export, account deletion and purge (SYS-001 to SYS-004, D-018, D-093).

**Owns.** `user` (extensions), `session`, `account`, `verification`.

| Service function | Rules |
|---|---|
| `getCurrentUser(actor): Promise<MeView>` | Returns profile, platform role, memberships with org names, active organization, capabilities |
| `updateProfile(actor, { name }): Promise<MeView>` | name 1–120 chars |
| `exportUserData(actor): Promise<UserExport>` | Profile, memberships, section memberships, runs (record-form exports), notifications, audit rows where actor; rate bucket `auth` 2/hour (`EXPORT_RATE_LIMITED`) |
| `requestAccountDeletion(actor): Promise<void>` | Sets `user.deleted_at`, revokes sessions (`auth.api.revokeSessions`), deletes memberships and pending invitations, audit `account.delete` |
| `purgeDeletedAccounts(): Promise<{ purged: number }>` (job) | For users with `deleted_at < now() − 30 days`: re-point `runs.student_id`, `run_events.actor_id`, `audit_logs.actor_id` to the org placeholder user `deleted-user@<slug>.tassl.local` (created on demand), delete `account`, `session`, `verification` rows, delete the user row |

Repository: `findUserById`, `findPlaceholderUser(orgId)`, `createPlaceholderUser(orgId)`, `listDeletedBefore(date)`, `repointUserReferences(fromId, toId)`, `deleteUser(id)`.

Errors: `EXPORT_RATE_LIMITED` (429), `USER_DELETED` (401).

## 2. `tenancy`

**Responsibilities.** Institutions (organizations), memberships, invitations, institution settings, data agreements (D-006, D-055, FR-234, SYS-005).

| Service function | Rules |
|---|---|
| `listMyInstitutions(actor)` | From `member` rows; includes role |
| `setActiveInstitution(actor, orgId)` | Must be a member; updates `session.active_organization_id` via Better Auth `setActiveOrganization` |
| `requireMembership(actor, orgId, roles?)` | Throws `FORBIDDEN` |
| `inviteMember(actor, orgId, { email, role })` | Actor: `instructor` or `program_lead`; role ∈ org roles; delegates to `auth.api.createInvitation`; email via `send_email` job; audit `invitation.create` |
| `acceptInvitation(actor, invitationId)` | Delegates to Better Auth; email must match |
| `getInstitutionSettings(actor, orgId)` / `updateInstitutionSettings(actor, orgId, { plan, defaultMapping })` | `program_lead` or admin; mapping validated (four positive numbers) |
| `upsertDataAgreement(actor, orgId, input)` / `listDataAgreements(actor, orgId)` | `program_lead` or admin write; editor reads own org rows; purposes subset of the three; audit `agreement.upsert` |
| `canReadIdentifiedRecords(actor, orgId): Promise<boolean>` | `actor.platformRole === 'tassl_scenario_editor'` and an active agreement (not deleted, `ends_at` null or future) whose `permitted_platform_roles` includes the role and `purposes` non-empty |
| `createInstitution(actor, { name, slug, programLeadEmail })` | Admin only; creates organization via Better Auth API, `institution_settings`, and the first `program_lead` member (user must exist) |

Repository: `findActiveAgreement(orgId)`, `upsertSettings`, `listAgreements`, `upsertAgreement`, `softDeleteAgreement`.

Errors: `INVITATION_EMAIL_MISMATCH` (409), `AGREEMENT_PURPOSES_INVALID` (400).

## 3. `courses`

**Responsibilities.** Courses, sections, section memberships, assignments, policy display configuration, mapping changes with recompute, run lists for instructors (FR-200 to FR-206, D-061, D-062, D-095).

| Service function | Rules |
|---|---|
| `createCourse(actor, orgId, { name, term, outsideAiPolicy?, mapping?, defaultRunWeight?, taughtConcepts? })` | Actor org role `instructor`; mapping default from institution settings; creates the course with `created_by = actor` |
| `listCourses(actor, orgId)` | Instructors and program leads see all; students see courses where they have a section membership |
| `getCourse(actor, courseId)` | Sections, assignments, policy, mapping, weights, membership counts |
| `updateCoursePolicy(actor, courseId, { outsideAiPolicy?, defaultRunWeight?, taughtConcepts?, critiqueWeightFactor? })` | `requireCourseInstructor` |
| `previewMappingChange(actor, courseId, newMapping): Promise<MappingChangePreview>` | Lists confirmed runs with `points_effective` now vs under the new mapping (FR-206) |
| `changeMapping(actor, courseId, { newMapping, confirm: true })` | Requires `confirm`; writes `course_mapping_changes`, updates `courses.mapping`, enqueues `recompute_exports { courseId }`; audit `mapping.change` |
| `recomputeExports({ courseId })` (job) | For every confirmed/recorded run in the course: recompute points from `effective_band`s, update `run_scores.points_*`, write a new `course_exports` version with reason `mapping_change` |
| `createSection(actor, courseId, { name })` | instructor |
| `addSectionMember(actor, sectionId, { email, role })` | The email must belong to an org member; upsert membership; audit `section_member.add` |
| `removeSectionMember(actor, sectionId, userId)` | Not allowed if the user has a run in the section that is not voided (`MEMBER_HAS_RUNS`) |
| `listSectionMembers(actor, sectionId)` | Roster |
| `createAssignment(actor, sectionId, { label, packageVersionId, variantId, workingClockSeconds?, weight?, isWalkthrough?, opensAt? })` | Package version must be `confirmed` (`PACKAGE_NOT_CONFIRMED`) and belong to the org; variant must belong to the version; `workingClockSeconds` ≥ 60 |
| `updateAssignment(actor, assignmentId, patch)` | Same checks; forbidden once any run exists that is not voided, except `label`, `isWalkthrough`, `opensAt` (`ASSIGNMENT_IN_USE`) |
| `getPolicyDisplay(actor, assignmentId): Promise<PolicyDisplay>` | `{ outsideAiPolicy, weight (assignment ?? course default), mapping, countsStatement: 'This run counts toward the course grade. Run one counts.' key in i18n, runType, workingClockSeconds (assignment ?? package), uncalibrated: true }` (FR-201) |
| `listAssignmentRuns(actor, assignmentId)` | Reviewers; each run with state, attempt, scoring status, latest export version |
| `listMyAssignments(actor)` | Students: assignments in their sections with their latest run |
| `deleteWalkthroughRun(actor, runId)` | Instructor of the section; only when `assignments.is_walkthrough` (D-104); hard-deletes the run and children (FK cascade), audit `run.delete` |

Repository: `findCourse`, `listCoursesForOrg`, `listCoursesForStudent`, `insertCourse`, `updateCourse`, `insertMappingChange`, `listConfirmedRunsForCourse`, `insertSection`, `upsertSectionMembership`, `deleteSectionMembership`, `listSectionMembers`, `insertAssignment`, `updateAssignment`, `findAssignmentWithContext` (course, section, package version, variant), `listRunsForAssignment`, `listAssignmentsForStudent`.

Errors: `PACKAGE_NOT_CONFIRMED` (409), `VARIANT_MISMATCH` (400), `ASSIGNMENT_IN_USE` (409), `MEMBER_HAS_RUNS` (409), `MAPPING_INVALID` (400), `MAPPING_CHANGE_UNCONFIRMED` (409), `NOT_SECTION_MEMBER` (403).

## 4. `scenarios`

**Responsibilities.** Package families and immutable versions, all elements, variants and states, element confirmation, package validation, snapshot, import/export, package and claim object views (FR-011, FR-021, FR-027, FR-028, FR-030, FR-057, FR-082, FR-093, FR-114, FR-142, FR-180, FR-185, FR-190, FR-192, FR-193, FR-194, FR-195, FR-196, SYS-026).

| Service function | Rules |
|---|---|
| `createPackageFromSeed(actor, orgId, { title, familyKey, conceptSet, seed: { caseTitle, publisher, licenseTerms, licensePermitsAdaptation, seedText } })` | `requireAuthorOnPackage` (org role instructor or scenario_author, or editor with author membership); `licensePermitsAdaptation` must be true (`LICENSE_NOT_CONFIRMED`); creates package + version 1 (`draft`) + seed record + two variants (defective, sound); returns version id; does not start generation |
| `listPackages(actor, orgId)` | Authors and instructors: all in org with latest version status, warnings (`FAMILY_LACKS_ETHICAL_DEFECT`, D-083) |
| `getPackageVersion(actor, versionId): Promise<PackageVersionView>` | Package view: id, version, status, calibration status, confirmation record (element confirmations summary), authoring record (generation runs, model, dates, editors), measures (FR-198), brief, counts; seed record only for authors/instructors/editors/admins (FR-028); students never |
| `getClaimObject(actor, versionId, claimId, variantId?)` | Claim object view (FR-180): text, source document and passage, importance, consequence, cost, concept, triggers, escalation reply, rationale, and per-variant state (evidence status, failure family, warranted stance, verification paths, planted), plus the confirmation row; reviewers and authors only |
| `updateElement(actor, versionId, elementType, elementId, patch)` | Version must be `draft` (`VERSION_FROZEN`); validates the element schema; bumps `revision`; records an `element_confirmations` row with decision `edited` when the actor is the authority, else leaves the element unconfirmed (author edits are confirmations) |
| `decideElement(actor, versionId, elementType, elementId, { decision: 'confirmed'|'rejected', note?, openedAt })` | Writes the confirmation row with `opened_at` (from the client, when the element was opened) and `decided_at = now`; `rejected` marks the element for regeneration (`authoring.regenerateElement`) or hand authoring |
| `confirmVersion(actor, versionId, { teachingNoteChecked: true })` | Requires every element to have a latest decision `confirmed` or `edited` (`ELEMENTS_UNCONFIRMED` with the list), `teaching_note_checked = true` (`TEACHING_NOTE_UNCHECKED`), and `validatePackage` to pass; sets `status = confirmed`, `confirmed_at/by`, writes `snapshot`; audit `package.confirm`; notifies org instructors; AN `package_confirmed` |
| `regenerateVersion(actor, versionId, { reason })` | Creates version n+1 as draft by copying every element (new ids; claims get new ids), seed record, variants; runs on the old version keep it (FR-195, FR-199) |
| `importPackage(actor, orgId, packageJson)` | Validates `PackageExportSchema`, creates package + version + elements, marks every element `confirmed` by the actor when `confirmOnImport: true` (fixture loading), runs `validatePackage` |
| `exportPackage(actor, versionId): Promise<PackageExport>` | The snapshot (or built on the fly for drafts); authors and reviewers |
| `validatePackage(version): ValidationResult` | Pure; rules table below |
| `getStudentScenario(actor, runId)` | Student view of brief, documents (id, key, title, author, date, body), named fields (key, label, unit); nothing else |

`validatePackage` rules (codes returned with the element ids at fault):

| Code | Rule | PRD |
|---|---|---|
| `BRIEF_TOO_LONG` | brief ≤ 200 words and non-empty | 7.2 |
| `DOCUMENT_COUNT` | 6 ≤ documents ≤ 12 | 7.2 |
| `DOCUMENT_TOO_LONG` | each body ≤ 2000 words | D-081 |
| `DOCUMENT_ROLES_MISSING` | ≥ 1 `superseded` (with a valid `superseded_by_document_id` in the room and a later `dated_on`), ≥ 1 `interpretation_as_fact`, ≥ 1 `irrelevant` | 7.2 |
| `STAKEHOLDER_NO_DOCUMENT` | every stakeholder has ≥ 1 document | 7.3 |
| `STAKEHOLDER_NO_CONTRADICTION` | at least one pair with `contradicts_stakeholder_id` and a `contradiction_point` | 7.3 |
| `ANSWER_SPACE_SINGLE` | ≥ 2 `defensible` positions | 7.18 |
| `ANSWER_SPACE_NO_INCONSISTENT` | ≥ 1 `evidence_inconsistent` with `ignored_evidence` | 7.18 |
| `ANSWER_SPACE_NO_MINIMUM` | exactly one position `is_minimum_commitment` | 7.10 |
| `NAMED_FIELDS_MISSING` | ≥ 1 named field | 7.10 |
| `CLAIMS_TOO_FEW` | ≥ 6 consequential claims | 7.18 (9) |
| `CLAIM_STATE_MISSING` | every claim has a state in both variants | 7.18 (9) |
| `DEFECTIVE_VARIANT_PLANT` | defective variant has exactly one `planted` defective claim, and it names a claim of this version; no other state carries `planted` in either variant; sound variant has none defective and none planted (D-202) | 12 |
| `VARIANTS_DIFFER_BEYOND_PLANT` | every claim except the planted one carries the same evidence status, failure family, warranted stance and planted flag in both variants (D-203) | 7.18 (9), 12 |
| `PLANTED_PATH_MISSING` | the planted claim has a `source_trace` path naming a document in the Evidence Room (or a `replication_check` when `failure_family = uncomputed_number` or `misapplied_method`) | 12 |
| `DEFECT_OUTSIDE_CONCEPTS` | the planted claim's `concept_key` ∈ `concept_set` | 7.18 Rules |
| `DEFECT_NOT_CONSEQUENTIAL` | the planted claim is `load_bearing` and `consequence_level ≠ low` | 7.18 Rules |
| `NO_STANCE_CHANGING_TRACE` | ≥ 1 non-planted claim with a `source_trace` path and `weakly_sourced` or `volatile` true | 7.18 (9) |
| `NO_ESCALATABLE_CLAIM` | ≥ 1 claim `escalatable` with a reply | 7.18 (9) |
| `NO_LOW_STAKES_SOUND` | ≥ 2 claims sound in both variants with `consequence_level = low` and warranted `accept` or `verify` | 7.18 (9) |
| `NO_ACCEPT_WARRANTED_SOUND` | ≥ 1 claim sound in both variants with warranted `accept` | 12 step 16 |
| `WARRANTED_STANCE_UNSET` | every state has a warranted stance | 7.8 |
| `TURN_MISSING` / `TURN_DELAY` | Turn exists; delay 60–120 | 7.11 |
| `QUESTION_BANK_INCOMPLETE` | for every claim: one `provenance` and one `verification`; for indexes 0–2: one `assumption`; one `confidence`; one `frame_vs_response`; ≥ 1 `counterfactual`; ≥ 1 `figure_provenance` (template with `{figure}`, no claim) when named fields exist (FR-025, D-135); ≥ 6 `default` | 7.18 (12) |
| `COUNTERFACTUAL_SENTENCES` | counterfactual has exactly 3 sentences | 7.14 |
| `READINESS_SPLIT` | 16 items: 6 `foundation`, 4 `defect_concept`, 6 `ai_behavior`, each with 4 options and a valid key; no item stem contains ≥ 8 consecutive words of any claim text | 7.1, AI-005 |
| `CLAIM_CONCEPT_UNKNOWN` | every `concept_key` ∈ concept set | 7.18 |
| `GENERAL_REPLY_MISSING` | non-empty `general_escalation_reply` | 7.9 |
| `RESKIN_LOG_EMPTY` | when a seed record exists: ≥ 3 entries with at least one of each kind | 7.2, 7.18 |

Repository: `insertPackage`, `insertVersion`, `findVersionFull` (all elements), `findVersionForRun` (elements without seed record), `listVersions`, `updateVersionStatus`, `insertSeedRecord`, `upsertElement<T>`, `listConfirmations`, `insertConfirmation`, `writeSnapshot`, `copyVersion`, `findClaimWithState`.

Errors: `VERSION_FROZEN` (409), `ELEMENTS_UNCONFIRMED` (409), `TEACHING_NOTE_UNCHECKED` (409), `PACKAGE_INVALID` (422, details = rule codes), `LICENSE_NOT_CONFIRMED` (400), `IMPORT_INVALID` (400).

Events emitted: none (packages are not runs); audit rows instead.

## 5. `authoring`

**Responsibilities.** AI-assisted generation pipeline as jobs, the warranted-stance table, generation records, retries, measures (AI-001, AI-005, FR-190, FR-191, FR-194, FR-197, FR-198, D-032, D-063).

| Service function | Rules |
|---|---|
| `startGeneration(actor, versionId)` | Version draft, seed present; enqueues `generate_package_step { step: 'reskin_brief_stakeholders', passNumber: 1 }`; each step enqueues the next on success; generation runs on `getProvider()` (mock unless `FEATURE_AI`) |
| `runGenerationStep({ packageVersionId, step, passNumber })` (job) | Inserts a `generation_runs` row `running`; builds the prompt input from the version's current elements; calls `structured()`; writes elements as draft rows (replacing previous unconfirmed elements of that type); runs the step's validation subset; on rule failure and `passNumber < 2`, re-enqueues the same step with `passNumber + 1` and the failed rules in the prompt input; on second failure marks `failed` with `failed_rules` and notifies (`generation_failed`); on success enqueues the next step; after step 7 runs `validatePackage` and notifies `generation_complete` with the rule report |
| `getGenerationStatus(actor, versionId)` | Steps with status, pass, tokens, cost, failed rules, errors |
| `regenerateElement(actor, versionId, elementType, elementId, { restatedRule? })` | Re-runs only the owning step for that element (documents, claims, questions, items are regenerated as a set; single elements are replaced by key) |
| `computeAuthoringMeasures(versionId): AuthoringMeasures` | `seedToConfirmedMs`, `editRate = edited/total`, `rejectedShare`, `generationPasses = max pass per step`, `reviewMsPerElement = mean(decided_at − opened_at)`; used by the package view and AN-001 |
| `proposeWarrantedStance(claim, state): Stance` | Table D-032 |

Step order and prompts: `11-llm-integration.md` §2.1 (`gen-reskin-brief-stakeholders` → `gen-documents` → `gen-answer-space-fields` → `gen-claims-states` → `gen-turn-probe` → `gen-question-bank-counterfactual` → `gen-readiness-items`). Each step's writes are one transaction; a step never runs while the version is confirmed.

Repository: `insertGenerationRun`, `updateGenerationRun`, `listGenerationRuns`, `replaceElements(versionId, type, rows)`.

Errors: `GENERATION_ALREADY_RUNNING` (409), `SEED_MISSING` (409), `GENERATION_STEP_FAILED` (in job result).

## 6. `runs`

**Responsibilities.** Run creation and lifecycle, policy display, readiness taking, Evidence Room opens, frame, brief drafts and Decision Lock, addendum, Turn delivery and response, pause and resume, void and re-offer, test controls, timers, clock (FR-001, FR-002, FR-010 to FR-018, FR-020 to FR-024, FR-040 to FR-044, FR-100 to FR-108, FR-110 to FR-118, FR-201, FR-231, FR-233, FR-235, FR-250, FR-251).

| Service function | Rules and events |
|---|---|
| `startRun(actor, assignmentId)` | Student in the section; assignment open; no active run (`RUN_ACTIVE_EXISTS`) unless re-offer; `attempt_no = max + 1`; copies `working_clock_seconds` and `turn_delay_seconds`; state `assigned`; `is_walkthrough` from assignment; returns run |
| `acknowledgePolicy(actor, runId)` | Writes `policy_displayed` with the display values; transition `assigned → readiness`; `readiness_started_at = now`, `readiness_expires_at = now + 8 min` (FR-010, FR-201) |
| `getReadiness(actor, runId)` | 16 items in position order without keys; remaining time |
| `answerReadinessItem(actor, runId, itemId, answerKey)` | Upsert answer; correctness computed server-side, not returned |
| `submitReadiness(actor, runId)` | Writes one `readiness_item` event per item (unanswered → `answer_key: null, correct: null`), computes `concepts` (`held` if all items on the concept correct, `not_held` if any answered wrong, `unknown` if any unanswered), writes `run_readiness_results`; transition to `framing` (FR-012, FR-014) |
| `skipReadiness(actor, runId)` | Allowed only after a failed submit (`readiness_submit_failed` flag) or expiry; `readiness_skipped` event; concepts `unknown`; transition (FR-018) |
| `getRunWorkspace(actor, runId)` | Materializes timers; returns student view: state, clock, brief, documents (ids, titles, dates, authors; body on open), frame (draft state or locked), delegations, claims (student view), brief draft, declaration, pause info, turn (if open), capabilities |
| `openDocument(actor, runId, documentId)` | State ∈ {framing, working, turn_open}; writes `document_open` `{ document_id, before_first_delegation: first_delegation_at == null, in_turn_window }`; inserts `run_document_opens`; returns the body; document-sourced claims become surfaced (`reliance.surfaceDocumentClaims`) (FR-022, FR-031) |
| `closeDocument(actor, runId, openId)` | Sets `closed_at`, `duration_ms = min(now − opened_at, remaining clock at open)`, `skim` (D-082); writes `document_close` |
| `lockFrame(actor, runId, { decision, assumptions[3], position, confidence })` | State `framing`; validation (FR-040); inserts `run_frames`; `frame_locked` event; `confidence_at_frame`; transition to `working`, `working_started_at = now` (FR-041) |
| `saveBriefDraft(actor, runId, draft)` | State `working` or `turn_open`? No: brief drafts only in `working`; upserts `run_briefs` (unlocked); writes `brief_opened`/`brief_closed` from client signals (`{ opened: true }` / `{ closed: true, durationMs }`) (FR-100) |
| `lockDecision(actor, runId, brief)` | State `working`; validate (FR-100, FR-103); compute relied-on: `reliance.markReliedOnFromNamedFields` (FR-101) then `reliance.findUnstancedReliedOn`; if any → `lock_refused` event and `LOCK_REFUSED_UNSTANCED_CLAIM { claimId, claimText }` (FR-084, FR-108); else `decision_locked` event (payload in §10), `confidence_at_lock`, `speed_outlier` when `now − working_started_at < 240 s` (FR-106), transition to `decision_locked`, `turn_due_at = now + turn_delay_seconds` (FR-102, FR-110) |
| `addAddendum(actor, runId, { text })` | State after lock and before `recorded`; ≤ 50 words; one per run (`ADDENDUM_EXISTS`); `addendum` event (FR-107) |
| `getTurn(actor, runId)` | Materializes; if `turn_open`: turn text, voice, window end, window claims (surfaced on delivery with `surfaced_by: turn`, relied-on by rule, FR-111, D-077) |
| `respondToTurn(actor, runId, { response, justification, confidence })` | State `turn_open`; justification ≤ 150 words; every window claim stanced (`TURN_CLAIMS_UNSTANCED`); `turn_response_locked` event; `confidence_after_turn`; transitions `turn_open → turn_locked → defense_pending` (FR-112) |
| `pauseRun(run, cause, related)` / `resumeRun(actor, runId)` | See `10-backend-spec.md` §10; resume allowed by the student from the paused overlay; `resume` credits the cost (FR-001) |
| `voidRun(actor, runId, { reason, reoffer: boolean, variantId? })` | `requireRunInstructor`; any state except `voided`; `run_voided` event; transition; if `reoffer`: create a new run for the same student on `variantId` (default: the other variant; if the family has only two variants and the other is in use, a fresh run on the same variant), link `re_offered_from/to`, `run_reoffered` event on the new run; audit (FR-002, FR-008, FR-183) |
| `forceAssistantFailure(actor, runId)` | `requireRunInstructor` and `flags.testControls`; sets `flags.forced_failure_armed = true`; audit `test_control.force_failure` (FR-118) |
| `materializeTimers(run)` | `10-backend-spec.md` §8 |
| `listMyRuns(actor)` | Student runs with state and labels |
| `getRunStatus(actor, runId)` | State, scoring status (`held` → under review), links |

Repository: `insertRun`, `findRunForUpdate`, `findRunFull`, `updateRun`, `nextAttemptNo`, `insertReadinessAnswer`, `listReadinessAnswers`, `insertReadinessResult`, `insertDocumentOpen`, `closeDocumentOpen`, `insertFrame`, `upsertBriefDraft`, `lockBrief`, `insertAddendum`, `insertTurnResponse`, `insertPause`, `resumePause`, `listRunsForStudent`.

Errors: `RUN_ACTIVE_EXISTS` (409), `ILLEGAL_TRANSITION` (409), `FRAME_INVALID` (400, details.field), `BRIEF_INVALID` (400, details.field), `LOCK_REFUSED_UNSTANCED_CLAIM` (409, details `{ claimId, claimText }`), `RUN_LOCKED` (409), `CLOCK_EXPIRED` (409), `ADDENDUM_EXISTS` (409), `TURN_NOT_OPEN` (409), `TURN_CLAIMS_UNSTANCED` (409, details.claimIds), `READINESS_SKIP_NOT_ALLOWED` (409), `TEST_CONTROLS_DISABLED` (403), `RUN_PAUSED` (409, for writes other than resume).

Edge cases: browser closed during `working` keeps the clock running (FR-117); a document open without a close is closed by the next open or by lock with `duration_ms` capped at the clock; lock during `paused` is refused (`RUN_PAUSED`).

## 7. `assistant`

**Responsibilities.** Delegations, trigger matching, claim surfacing, connective text, numeric guard, used marks, why lines, outside-tool declaration, Sycophancy Probe reversal (FR-050 to FR-056, FR-060 to FR-064, AI-002, AI-004, D-030, D-068, D-088).

| Service function | Rules and events |
|---|---|
| `delegate(actor, runId, { request }): AsyncIterable<DelegationChunk>` | State `working` or `turn_open` (else `ASSISTANT_LOCKED`); request ≤ 2000 chars; rate bucket `llm`; if `flags.forced_failure_armed` → clear the flag, pause the run with cause `assistant_failure`, throw `ASSISTANT_UNAVAILABLE` (FR-118); charge no clock; `first_delegation_at` set if null; match triggers (`triggers.ts`: deterministic then AI-004 per D-030) against claims not yet surfaced (already-surfaced claims are referenced, not re-surfaced); if the probe claim is matched and the student previously set `challenge` on it → probe path (D-088); insert `run_delegations` row (empty response), then stream `assistant-reply@1`; on completion: numeric guard, defect-word filter, marker check, update the row, write `delegation` event, surface claims (`reliance.surfaceClaims(..., 'delegation')`); on provider failure: mark `failed`, pause the run with the delegation id, write `delegation` event with `failed: true` (FR-001) |
| `listDelegations(actor, runId)` | Log view: request, response, claims with current stances, why, flags, used marks (FR-060) |
| `updateDelegation(actor, runId, delegationId, { why?, usedClaimIds? })` | `why` ≤ 200 chars; marking used writes `claim_used { via: 'log_mark' }` and sets `relied_on_via` (FR-060, FR-084) |
| `declareOutsideTool(actor, runId, { purpose })` | Any state from `working` to `defense_pending`; `outside_tool_declared` event; no other effect (FR-061) |
| `flagDelegation(actor, runId, delegationId, flag)` | Reviewer; adds `out_of_scenario`; excluded from Delegation reads (FR-055) |

Trigger matching (`triggers.ts`): `normalize(text)` = NFKD, lower-case, strip punctuation, collapse whitespace; a claim matches when any `trigger_phrases[i]` is a substring of the normalized request, or every token of the phrase appears in the request's token set. With `TRIGGER_MATCHING=llm_first` the classifier runs first and the deterministic match is the fallback.

Assistant reply assembly: `segments` alternate text and `{ claimId }` items in the order the model placed markers; missing markers are appended as claims first; the world summary passed to the prompt is the brief plus stakeholder names and roles (never positions or blind spots verbatim beyond what documents say).

Repository: `insertDelegation`, `completeDelegation`, `failDelegation`, `listDelegations`, `updateDelegation`.

Errors: `ASSISTANT_LOCKED` (409), `ASSISTANT_REQUEST_TOO_LONG` (400), `ASSISTANT_UNAVAILABLE` (503, run paused), `DELEGATION_NOT_FOUND` (404).

## 8. `reliance`

**Responsibilities.** Claim surfacing and student claim views, stances, interrogation actions, escalations, relied-on detection, lock gate (FR-070 to FR-075, FR-080 to FR-087, FR-090 to FR-093, D-076, D-077, D-089).

| Service function | Rules and events |
|---|---|
| `surfaceClaims(tx, run, claimIds, by, byId)` | Inserts `run_claims` rows for new claims with `surfaced_by`, `in_turn_window`; in the Turn window sets `relied_on_via += turn_window` and writes `claim_used { via: 'turn_window' }` (D-077) |
| `surfaceDocumentClaims(tx, run, documentId)` | Claims with `source_kind = document` and `source_document_id = documentId` (FR-031) |
| `listRunClaims(actor, runId)` | Student view: id, key, text, surfaced by, stance, previous stance, available actions (`source_trace` when the claim has a source document; `replication_check`/`decomposition_check` when the state has the path), escalatable, escalation reply if escalated, actions run with results; never warranted stance or evidence status |
| `setStance(actor, runId, claimId, stance)` | State `working` or `turn_open`; claim surfaced; `previous_stance` kept; `action_ids` = actions on the claim so far; `stance_set` event; if `stance = escalate` the client must call `escalate` (the stance is recorded; the escalation charge happens in `escalate`) (FR-080, FR-085) |
| `runAction(actor, runId, claimId, type)` | State `working` (clock > 0, `CLOCK_EXPIRED`) or `turn_open` (window remaining > 0, `TURN_WINDOW_EXPIRED`); type available for the claim (`ACTION_NOT_AVAILABLE`); charge the cost first (`chargeCost` on the working clock, or the window deduction of `10-backend-spec.md` §10 in the window, D-132), then return the authored result from `verification_paths` (FR-070 to FR-073); `action` event |
| `escalate(actor, runId, claimId, { statement })` | State `working` (clock > 0) or `turn_open` (window remaining > 0); statement 3 words to 280 chars (D-089); if the claim has `escalation_reply`: count against the limit (`ESCALATION_LIMIT_REACHED` when 2 already counted), `response_id = 'claim'`; else `general`, not counted (FR-090 to FR-092); charge 300,000 ms on the working clock or the window (D-132); sets stance `escalate` if not already; `escalation` event |
| `markReliedOnFromNamedFields(tx, run, namedValues)` | For each named value, claims whose `carried_values` match by D-076 → `relied_on_via += named_field`, `claim_used { via: 'named_field', field_key }` (FR-101) |
| `findUnstancedReliedOn(tx, run): RunClaim[]` | `relied_on = true and stance is null`, ordered by `surfaced_at` (FR-084) |
| `stanceMatrixInput(run, events, package)` | Used by scoring: rows for every consequential claim in the variant (surfaced or not; unsurfaced rows are `not surfaced`) |

Repository: `upsertRunClaim`, `listRunClaims`, `findRunClaim`, `setStance`, `insertAction`, `listActions`, `insertEscalation`, `countCountedEscalations`, `updateReliedOn`.

Errors: `CLAIM_NOT_SURFACED` (409), `ACTION_NOT_AVAILABLE` (409), `CLOCK_EXPIRED` (409), `ESCALATION_LIMIT_REACHED` (409), `ESCALATION_STATEMENT_INVALID` (400), `STANCE_INVALID` (400).

## 9. `defense`

**Responsibilities.** Question selection, rendering, follow-ups, answers, completion (FR-120 to FR-126, D-031, D-080, D-090).

| Service function | Rules and events |
|---|---|
| `openDefense(actor, runId)` | State `defense_pending`; on first open: select questions (below), insert `run_defense_questions`, write `defense_question` events, `defense_opened_at`; returns questions in order with answered state, the locked brief, frozen frame, Turn response; no assistant or documents (FR-120, FR-126) |
| `answerQuestion(actor, runId, runQuestionId, { text, durationMs })` | ≤ 5,000 chars; insert answer; `defense_answer` event; then follow-up rule: if the question has no follow-up yet and (deterministic trigger D-031 or verbatim-brief rule D-090) → insert the follow-up question (`follow_up_of`), `defense_question` event; returns the next question (FR-123, FR-124, FR-125) |
| `completeDefense(actor, runId)` | All questions answered (empty answers allowed; `nothing_answered` flag when every answer is empty or under 3 words); transition to `defense_complete`; `defense_completed_at`; enqueue `score_run` after commit (D-046) |

Selection (`selection.ts`, pure over events + bank + package):

1. Candidates in order: `provenance` for each consequential claim relied on with no `source_trace` action (load-bearing first, then by surfaced time); `figure_provenance` for each named field value that matches no claim and no document number (FR-025); `verification` for each claim with `previous_stance` not null and an action before `stance_set_at`; `assumption` for each frame assumption index whose normalized token overlap with the brief assumptions ∪ Turn justification is < 0.5, or all three when the response is `reverse`; `confidence` when `confidence_at_lock > confidence_at_frame` (D-080); `frame_vs_response` when a non-implicit Turn response exists (D-106); `counterfactual` for each counterfactual question whose named field was entered.
2. Take the first 9.
3. If fewer than 6, append `default` questions in position order until 6.
4. Render templates with `{claim_text}`, `{figure}` (the named value with unit), `{stance}`, `{document_title}` (source document), `{assumption}`.

Repository: `insertRunQuestions`, `listRunQuestions`, `insertAnswer`, `findRunQuestion`.

Errors: `DEFENSE_NOT_OPEN` (409), `QUESTION_ALREADY_ANSWERED` (409), `DEFENSE_INCOMPLETE` (409, details.unanswered).

## 10. `trace`

**Responsibilities.** Append-only events, sequencing, reading, the two export forms, the claim table (FR-007, FR-240 to FR-243, NFR-005).

| Service function | Rules |
|---|---|
| `append(tx, run, type, payload, { actorId?, occurredAt? })` | Uses `run.next_event_seq` (row locked), stores `clock_remaining_ms` from `remainingMs(run, occurredAt)` (or window remaining), increments the allocator |
| `listEvents(actor, runId)` | Reviewers, owner (owner view redacts `draft_band.quotes`? No: the student sees quotes in the debrief; the owner view omits nothing except reviewer notes marked private, of which there are none) |
| `buildExport(runId, form: 'course' | 'record'): TraceExport` | Header, events, claim table, computed fields; `course` adds `weight`, `mapping`, `points`; `record` omits them at every depth: the header `policy` is reduced to `{ outside_ai_policy }` and the `policy_displayed` event payload to `{ outside_ai_policy, run_type, counts_statement }`, and the FR-170 test asserts no `weight`, `mapping`, or `points` key anywhere in the record form (FR-243) |
| `TraceExportSchema` | Zod; `x-tassl-extensions` lists the build-added event types (FR-241) |

Event payloads (all fields snake_case; ids are UUID strings):

| Type | Payload |
|---|---|
| `policy_displayed` | `{ outside_ai_policy, weight, mapping, run_type, counts_statement: true }` |
| `lifecycle` | `{ from, to, cause }` |
| `readiness_item` | `{ item_id, item_key, category, concept_key, answer_key, correct }` |
| `readiness_skipped` | `{ reason: 'expired'|'student_skip', unanswered_count }` |
| `document_open` | `{ open_id, document_id, document_key, before_first_delegation, in_turn_window }` |
| `document_close` | `{ open_id, document_id, duration_ms, before_first_delegation, skim, in_turn_window }` |
| `frame_locked` | `{ decision, assumptions: [3], position, confidence }` |
| `delegation` | `{ delegation_id, seq, request_text, response_text, claim_ids, why, in_turn_window, flags, unverified_numbers: [{ value, context }], failed }` |
| `claim_used` | `{ claim_id, via: 'log_mark'|'named_field'|'turn_window', field_key?, delegation_id? }` |
| `stance_set` | `{ claim_id, stance, previous_stance, action_ids, in_turn_window }` |
| `action` | `{ action_id, type, claim_id, clock_cost_ms, result, in_turn_window }` |
| `escalation` | `{ escalation_id, claim_id, statement, response_id, response_text, clock_cost_ms, counts_against_limit, in_turn_window }` |
| `outside_tool_declared` | `{ purpose }` |
| `pause` | `{ pause_id, cause, related_delegation_id }` |
| `resume` | `{ pause_id, paused_ms, clock_credited_ms }` |
| `lock_refused` | `{ reason: 'unstanced_relied_on'|'brief_invalid', claim_id?, claim_text?, field? }` |
| `decision_locked` | `{ recommendation, rationale, assumptions: [3], change_my_mind, named_values, confidence, auto, speed_outlier, relied_on_claim_ids, unstanced_relied_on_claim_ids, elapsed_ms }` |
| `brief_opened` | `{}` |
| `brief_closed` | `{ duration_ms }` |
| `addendum` | `{ text }` |
| `turn_delivered` | `{ turn_id, text, voice, window_ends_at, window_claim_ids }` |
| `turn_response_locked` | `{ response, justification, confidence, implicit }` |
| `defense_question` | `{ run_question_id, question_id, kind, seq, rendered_text, follow_up_of, selecting_event_seq }` |
| `defense_answer` | `{ run_question_id, text, duration_ms }` |
| `draft_band` | `{ dimension, band, status, reason, basis, provisional, graph_keys, evidence_event_seqs, quotes: [{ event_seq, text }], rationale }` |
| `band_decision` | `{ dimension, decision, band, note }` |
| `claim_neutralized` | `{ neutralization_id, claim_id, reason, credit_challenge, note, recompute: { dimensions, bands_before, bands_after, points_before, points_after } }` |
| `run_voided` | `{ reason, note, re_offered_run_id }` |
| `run_reoffered` | `{ from_run_id, variant_id }` |
| `debrief_opened` | `{ version: 'draft'|'confirmed' }` |
| `debrief_answer` | `{ stance_to_change, do_differently }` |
| `probe_fired` | `{ claim_id, scripted_reversal }` |

Export header (FR-240): `run_id, package_id, package_version, variant_key, mode, package_confirmation_record: [{ element_type, element_id, decision, decided_by_role, decided_at }], policy: { outside_ai_policy, weight, mapping }, working_clock_seconds, working_clock_uncalibrated: true, readiness: [{ concept_key, status }], transitions: [{ state, at }], is_walkthrough, x_tassl_extensions: [...]`. Computed block: `confidence: { frame, lock, turn }, false_challenge_rate, points (course form only), rubric_version, exported_at, export_version`.

Claim table rows: `claim_id, claim_version (package version), key, evidence_status, failure_family, importance, consequence_level, warranted_stance, stance_taken, stance_taken_at, previous_stance, actions: [type], relied_on, relied_on_via, neutralized, inconsistency_credited, readiness_context`. In the record form the same table is present (the PRD says the record carries the claim table).

Repository: `insertEvent`, `listEventsForRun`, `listEventsByType`.

Errors: `SEQUENCE_CONFLICT` (500, retried once inside the transaction wrapper).

## 11. `scoring`

**Responsibilities.** Graphs, rubric, categorical facts, model reads, draft bands, points, FCR, neutralization recompute, held runs (FR-004, FR-005, FR-087, FR-130 to FR-143, FR-202, FR-203, FR-232, AI-003, D-033, D-078, D-079, D-091).

Pipeline (`scoreRun` job): read events + package version + variant states → `buildGraphs` (pure) → `categoricalFacts` (pure) → `reads` (five `structured()` calls, skipped or degraded per `11-llm-integration.md` §3) → `draftBands` (pure given facts + reads + rubric) → write `draft_band` events and `run_bands`, `run_scores` (graphs, FCR, matched share, `points_draft`), flags → transition to `scored`; notify student (`run_scored`) and section instructors; AN `run_scored`. Failure after retries → `scoring_status = 'held'`, notify instructors (`run_held`), run stays `defense_complete` (FR-140).

### 11.1 Graph builders (`graphs/*.ts`, pure functions of `(events, package, variant)`)

| Key | Output | Rules |
|---|---|---|
| `confidence_line` | `{ available, points: [{ at, confidence, accuracy, relied_on_claim_ids, accurate_claim_ids }], data_table, description }` | At each of frame/lock/turn: relied-on claims at that time (frame: none relied on → accuracy `null`); accurate = sound, or an action ran on it before that point (D-078); `available = false` with `missing_event_types` when `frame_locked` or `decision_locked` is absent |
| `clock_timeline` | `{ available, total_ms, segments: [{ type: reading|delegation|action|escalation|brief|unattributed|turn_response|paused, start_ms, end_ms, ref_id, document_id?, claim_ids }], marks: [{ at_ms, kind: claim_touch|clock_credit|lock|turn_delivered, ref_id }], window: {...same for the Turn window}, data_table, description }` | Built from open/close, delegation, action, escalation, brief open/close, pause/resume; overlapping reading and brief segments are split; unattributed fills gaps |
| `stance_matrix` | `{ available, rows: [{ claim_id, key, text, surfaced, stance_taken, stance_taken_at, previous_stance, preceding_action, evidence_status, importance, load_bearing, warranted_stance, readiness_context, relied_on, neutralized, inconsistency_credited, match }], summary: 5×5 counts (taken × warranted) over non-neutralized rows, false_challenge_rate, matched_share, data_table, description }` | `match = stance_taken === warranted_stance` or `inconsistency_credited`; FCR per FR-134 with denominator = all consequential claims in the variant minus neutralized; unsurfaced claims count in the denominator and as `stance_taken: null` (a defect never met is neither matched nor a false challenge) |
| `frame_beside_decision` | `{ available, frame, brief, addendum, turn: { text, response, justification, confidence, implicit }, disrupted_assumption_indexes, data_table, description }` | D-079 for disruption marking |

`description` strings are built from i18n templates with numbers, never from model output.

### 11.2 Categorical facts

`facts.ts` computes, among others: `defectsInVariant`, `defectsSurfaced`, `defectsKeptFromDecision` (stance ∈ {challenge, reject, escalate} or an action ran and the final stance ≠ accept), `actionsOnLoadBearing`, `actionsOnNonWarranting` (claims whose warranted stance is `accept`), `assertedVerification` (stance `verify` with no action), `misreadTrace` (a `source_trace` on a defective claim followed by `accept`), `escalationsInsideCompetence` (escalated claims whose concept is `held`), `acceptEverything`, `fcr`, `confidenceShape` (`flat_50`, `flat_100`, `rising_unchecked` when lock > frame and accuracy at lock < 0.5), `responseVsWarrant` (`match`, `over_adaptation`, `under_adaptation`, `implicit_hold_ok`, `implicit_hold_failed`), `recommendationEmpty`, `nothingAnswered`, `readOrderBeforeAssistant` (documents opened before first delegation), `delegationCount`, `whyLineCount`, `stanceRecordsLostShare`.

### 11.3 Band drafting rules (rubric v1 = Appendix A verbatim; thresholds as constants)

Dimension → graphs (FR-136): Framing {frame_beside_decision, clock_timeline}; Delegation {clock_timeline}; Verification {clock_timeline, stance_matrix}; Calibration {stance_matrix, confidence_line}; Decision Quality {frame_beside_decision}; Adaptation {frame_beside_decision}; Ownership {defense transcript against all four}. A dimension is unassessed when any of its graphs is unavailable.

| Dimension | Categorical placement | Model read (AI-003) |
|---|---|---|
| Verification | Professional: every planted defect surfaced by a check on it, or (defect-free) every action landed on a claim warranted `verify` (including zero actions); Proficient: ≥ 1 action on a load-bearing claim and no `misreadTrace`; Developing: actions exist but none on load-bearing claims, or `misreadTrace`; Novice: no action on any relied-on claim, or `assertedVerification` and no actions | none (computed) |
| Calibration | Novice: `acceptEverything` with ≥ 1 defect, or FCR ≥ 0.5, or every escalation inside competence (≥ 2); Developing: all defects kept from decision but FCR ≥ 0.15; Proficient: all defects kept from decision and FCR < 0.30 with false challenges only on `weakly_sourced` or high-consequence claims; Professional: all defects kept from decision, FCR < 0.15, escalations only outside competence, and `confidenceShape ≠ rising_unchecked`; defect-free variant: Professional when `acceptEverything` or no false challenges, else by FCR as above; `flat_50` or `flat_100` caps at Developing | none (computed); confidence interpreted from the line |
| Framing | Novice floor when any field is one token; otherwise the read decides within the descriptors; `readOrderBeforeAssistant = 0` blocks Professional | `band-read-framing` |
| Delegation | No delegations: read the stated reason (why lines absent → defense answers, basis `defense_only`); incomplete log → basis `defense_only` (FR-064); flagged delegations excluded | `band-read-delegation` |
| Decision Quality | Novice when `recommendationEmpty` or the read matches an `evidence_inconsistent` position, or the recommendation declines where a minimum commitment exists; otherwise the read | `band-read-decision-quality` |
| Adaptation | `over_adaptation` or `under_adaptation` → Novice; `implicit_hold_ok` → Developing (D-108 reading of "mid-band"); `implicit_hold_failed` → Novice; `match` → read decides Proficient vs Professional; hold with reason and warranted revision are scored identically (the read never lowers a matching hold) | `band-read-adaptation` |
| Ownership | `nothingAnswered` → Novice + flag; Defense Missed → Novice (unreachable); otherwise the read against expected-answer notes with the follow-up rule (A.7 boundaries) | `band-read-ownership` |

Every band records `graph_keys`, `evidence_event_seqs` (the events the facts used), `quotes` from the read, `provisional = true` for read-based bands, `basis`, and `rationale` (i18n template + read rationale). Unassessed reasons: `graph_unavailable`, `no_evidence`, `stance_records_lost`, `read_failed`.

Stance-record loss (FR-087): `stanceRecordsLostShare > 1/3` → the job sets `scoring_status = 'held'` with reason `unscoreable` and notifies instructors to void; `≤ 1/3` → Verification and Calibration unassessed with reason `stance_records_lost`.

### 11.4 Points (FR-202, FR-203, D-091)

```ts
export function computePoints(bands: Record<Dimension, Band | 'unassessed' | null>, mapping: Mapping): number | null
// mean over dimensions whose value is a band; null when none; rounded to 3 decimals
```

`points_draft` from draft bands (labeled draft in the debrief, never exported); `points_confirmed` from `effective_band`s once every dimension has a decision; `points_effective = max(points_before_correction, points_after_correction)` after any correction (FR-005).

### 11.5 Neutralization recompute (FR-005, FR-232)

`recomputeAfterNeutralization(runId, neutralization)`: mark the run claim neutralized (and `inconsistency_credited` when `credit_challenge`), rebuild the stance matrix and facts without that row, recompute Verification and Calibration categorical bands and FCR; for each affected dimension set `band_before_correction = effective`, `band_after_correction = new`, and the effective band becomes the higher; recompute points before/after/effective; write the `claim_neutralized` event with the recompute block; set `adjusted_at`; if the run was confirmed or recorded, write a new course export with reason `neutralization` (FR-184). Free-text dimensions are not recomputed (their reads did not depend on the claim).

Repository: `upsertBands`, `upsertScore`, `findScore`, `updateScoringStatus`.

Errors: `RUN_NOT_SCORABLE` (409), `RUBRIC_VERSION_UNKNOWN` (500).

## 12. `review`

**Responsibilities.** Faculty replay, band decisions, confirm-all, neutralization entry point, manual banding for held runs, illustrative queue (FR-180 to FR-186, FR-003, FR-008, FR-118, FR-140, D-092, D-096).

| Service function | Rules and events |
|---|---|
| `getReplay(actor, runId): ReplayBundle` | `requireRunReviewer`; events in order with clock; four graphs; defense transcript (questions, answers, follow-ups, expected-answer notes); bands with evidence and decisions; readiness concept map; package view; claim object views; declarations with course policy; unverified numbers; flags; uncalibrated labels; capabilities (`canDecide`: instructor or TA; TA cannot change an instructor-decided band) |
| `decideBand(actor, runId, dimension, { decision: 'confirmed'|'overridden'|'unassessed', band?, note? })` | State `scored` (or `confirmed`/`recorded` for a re-decision by an instructor within the build; each re-decision re-exports); `overridden` requires `band`; writes `band_decision`; audit `band.decide`; when all seven have decisions → transition `scored → confirmed`, compute `points_confirmed`, write course export v1 (reason `initial`), notify student (`bands_confirmed`), and if a `debrief_answer` event already exists for the run transition `confirmed → recorded` in the same transaction (FR-152); AN `band_decided`, `run_confirmed` (FR-181) |
| `confirmRemaining(actor, runId)` | Confirms every undecided dimension with its draft (unassessed drafts become `unassessed`); the same confirmation and `recorded` rules as `decideBand` apply |
| `neutralizeClaim(actor, runId, claimId, { reason, creditChallenge, note })` | `requireRunInstructor`; inserts `claim_neutralizations`; calls `scoring.recomputeAfterNeutralization`; sets the package version `review_requested_at/reason` (FR-003); audit |
| `bandHeldRunManually(actor, runId, bands)` | For `scoring_status = 'held'`: reviewer supplies a band or unassessed per dimension; writes `draft_band` events with basis `none` and `rationale = 'manual'`, then decisions as confirmed; transition `defense_complete → scored → confirmed` (then `→ recorded` if a `debrief_answer` exists) (FR-140) |
| `getQueue(actor)` | Illustrative sample rows (labeled) plus real runs in `scored` for the actor's sections under a separate heading (D-096) |
| `listSectionRunsForReview(actor, sectionId)` | Runs with state and decision progress |

Repository: `findReplayData`, `insertNeutralization`, `listNeutralizations`.

Errors: `BAND_DECISION_INVALID` (400), `RUN_NOT_SCORED` (409), `BAND_LOCKED_BY_INSTRUCTOR` (403, TA), `RUN_NOT_CONFIRMED` (409, export), `NEUTRALIZATION_EXISTS` (409).

## 13. `debrief`

**Responsibilities.** Debrief assembly in the fixed order, the two questions, the Recorded transition (FR-150 to FR-155, FR-152, D-091).

| Service function | Rules and events |
|---|---|
| `getDebrief(actor, runId): DebriefView` | Owner or reviewer; state ≥ `scored`; writes `debrief_opened { version }` on the first open per version; sections in order: frame-beside-decision; stance matrix claim by claim with `rationale` from the package and the student's stance; missed defects (planted claims not kept from the decision) with the source document, the authored action path, and its clock cost; probe transcript if `probe_fired`; confidence line; Turn beside frame; clock timeline; counterfactual; bands (draft or confirmed with note) with graph links and evidence; mapping, weight, provisional points labeled draft or confirmed points; done-well item (§13.1); the two questions (answered state); sections without data render `not_available` with a reason (FR-155) |
| `answerDebrief(actor, runId, { stanceToChange, doDifferently })` | Owner; each ≤ 100 words; `debrief_answer` event; if state `confirmed` → transition to `recorded`; if `scored` → stays until confirmation, then `recorded` on confirmation (FR-152) |

13.1 "Done well" selection (FR-153): the first that exists: a matched stance on a load-bearing claim; a correctly read Source Trace (action on a defective claim followed by a non-accept stance); a hold or revision matching the warrant; escalation outside competence; a complete frame with all assumptions load-bearing (read quote); otherwise "You completed the frame before the assistant unlocked." (i18n key `debrief.doneWell.fallback`).

Copy rules (FR-153): templates never contain "cheat"; failures reference actions ("accepted without a Source Trace") from a fixed template set; a unit test scans all debrief templates for forbidden words.

Repository: `findDebriefData`, `insertDebriefAnswer`.

Errors: `DEBRIEF_NOT_AVAILABLE` (409), `DEBRIEF_ANSWERED` (409).

## 14. `records`

**Responsibilities.** Single-run Judgment Record, record export, course exports, sample data (FR-170 to FR-173, FR-184, FR-204, FR-243, FR-254, D-035, D-087).

| Service function | Rules |
|---|---|
| `getRecord(actor, runId)` | Owner; state `confirmed` or `recorded`; builds or returns the snapshot: four graphs, confirmed bands with evidence and notes, mode, variant, record-form trace; `hidden_from_export` present, unused |
| `exportRecord(actor, runId)` | JSON download of the record form |
| `writeCourseExport(tx, run, reason)` | Next version; file = course form; audit `export.write`; notification `export_ready` to section instructors |
| `getCourseExport(actor, runId, version | 'latest')` / `listCourseExports(actor, assignmentId)` | Reviewers |
| `sample.trajectory()` / `sample.queue()` | Static fixtures, only when `flags.sampleData` |

Repository: `upsertRecord`, `findRecord`, `insertExport`, `findExport`, `listExports`.

Errors: `RECORD_NOT_AVAILABLE` (409), `EXPORT_NOT_FOUND` (404).

## 15. `notifications`

| Service function | Rules |
|---|---|
| `notify(tx, { userIds, type, title, body, link, payload, orgId })` | Inserts rows; enqueues `send_email` copies when `NOTIFY_EMAIL_COPIES` for types `generation_complete`, `generation_failed`, `run_scored`, `run_held`, `bands_confirmed` |
| `listNotifications(actor, { cursor, limit })` / `markRead(actor, id)` / `markAllRead(actor)` | Owner only |

Errors: none beyond global.

## 16. `admin`

| Service function | Rules |
|---|---|
| `listUsers(actor, { cursor, limit, q? })` | Platform admin; email prefix filter |
| `setPlatformRole(actor, userId, role)` | Admin; audit `role.set`; revoke the user's sessions |
| `listAuditLog(actor, { cursor, limit, orgId? })` | Admin |
| `getFlags(actor)` | Admin; the three flags and `effectiveLlmProvider()` |
| `audit(tx, { actorId, orgId, action, targetType, targetId, metadata })` | Helper used by every module; includes the request id |

Errors: `ROLE_INVALID` (400).

## 17. Validation schemas (per module `schema.ts`, key ones)

| Schema | Fields |
|---|---|
| `LockFrameSchema` | `decision: wordLimit(50).min(1)`, `assumptions: z.tuple([wordLimit(25).min(1)×3])`, `position: wordLimit(100).min(1)` (min applied to the stripped, trimmed text; `FRAME_INVALID` names the empty field), `confidence: z.number().int().min(0).max(100)` |
| `BriefSchema` | `recommendation: wordLimit(120)`, `rationale: wordLimit(250)`, `assumptions: tuple(wordLimit(25)×3)`, `changeMyMind: wordLimit(60)`, `confidence`, `namedValues: z.record(fieldKey, z.coerce.number().finite())` with every package named field required at lock |
| `TurnResponseSchema` | `response: z.enum(['hold','revise','reverse'])`, `justification: wordLimit(150)`, `confidence` |
| `AddendumSchema` | `text: wordLimit(50).min(1)` |
| `DelegationRequestSchema` | `request: z.string().trim().min(1).max(2000)` |
| `SetStanceSchema` | `stance: StanceEnum` |
| `EscalationSchema` | `statement: z.string().trim().min(1).max(280).refine(words ≥ 3)` |
| `DefenseAnswerSchema` | `text: z.string().max(5000)`, `durationMs: z.number().int().nonnegative()` |
| `DebriefAnswersSchema` | two `wordLimit(100).min(1)` |
| `BandDecisionSchema` | `decision`, `band?`, `note?: z.string().max(1000)` |
| `NeutralizeSchema` | `reason: NeutralizationReasonEnum`, `creditChallenge: z.boolean()`, `note: z.string().max(1000)` |
| `CreatePackageFromSeedSchema` | `title 1–200`, `familyKey /^[a-z0-9-]{3,60}$/`, `conceptSet: z.array(z.string().min(2)).min(4)`, `seed: { caseTitle, publisher, licenseTerms, licensePermitsAdaptation: z.literal(true), seedText: z.string().min(200).max(200000) }` |
| `PackageExportSchema` | The snapshot format (all element tables as arrays keyed by `key`) |
| `MappingSchema` | `{ novice, developing, proficient, professional }` each `z.number().positive()` |
| `CreateAssignmentSchema` | as in §3 |
| `TraceExportSchema` | §10 |

`wordLimit(n)` = `z.string().overwrite(stripMarkup).refine(t => countWords(t) <= n, { error: 'WORD_LIMIT', params: { limit: n } })`. `overwrite` rather than `transform`: in Zod 4 a transform returns a `ZodPipe`, which would make the `wordLimit(50).min(1)` this table uses impossible; `overwrite` is the check that rewrites the value in place and keeps the string type, so a later `.min(1)` reads the stripped, trimmed text, which is what this table means by it (D-200).

## 18. Notes on decisions introduced here

- D-106: an implicit hold is not a "Turn response" for the `frame_vs_response` question (the student wrote nothing to compare).
- D-107: unsurfaced consequential claims count in the FCR denominator and appear in the matrix as "not surfaced" rows with no match, keeping the PRD arithmetic (all consequential claims in the run).
- D-108: "mid-band for holding" (PRD §7.11) is read as Developing, following Appendix A.6.

These three rows are appended to `DECISIONS.md`.
