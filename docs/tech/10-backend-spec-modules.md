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
| `VARIANT_ACTIONS_DIFFER` | every claim offers the same **set of action types** in both variants — the keys of `verification_paths`, which is what `ClaimView.availableActions` projects onto the student's claim card. The payload behind a key may differ, and on the planted claim it must; the menu may not, because a check offered on one variant and not the other says which variant the student drew and, on the planted claim, where the defect is. The rule `VARIANTS_DIFFER_BEYOND_PLANT` deliberately leaves out, and it also covers the planted claim, which that one skips (D-330) | 7.18 (9), 12 |
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
| `QUESTION_TEMPLATE_PLACEHOLDER` | every `{name}` in a question's `template` and in its `follow_up` is one the renderer fills — `{claim_text}`, `{figure}`, `{stance}`, `{document_title}`, `{assumption}` (D-369) | 7.18 (12) |
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
| `getRunWorkspace(actor, runId)` | Materializes timers; returns student view: state, clock, brief, documents (ids, titles, dates, authors; body on open), frame (draft state or locked), brief draft, pause info (`{ cause, pausedAt }`), turn (if open), capabilities. The delegations and the claims are **not** on it: each is its own endpoint, and building them here would make `runs` and `assistant` a cycle (D-268) |
| `openDocument(actor, runId, documentId)` | State ∈ {framing, working, turn_open}; writes `document_open` `{ document_id, before_first_delegation: first_delegation_at == null, in_turn_window }`; inserts `run_document_opens`; returns the body; document-sourced claims become surfaced (`reliance.surfaceDocumentClaims`) (FR-022, FR-031) |
| `closeDocument(actor, runId, openId)` | Sets `closed_at`; `duration_ms` is the time the document was open, bounded at a day (D-249) and cut short by the clock's end only when that instant falls inside the open (D-250) — and the clock is the one the open was made under, the window's end for an open inside the Turn window and the working clock's zero or the lock instant for anything earlier, because the run's two clocks have a gap between them (D-338); `skim` is read from how long it was open rather than from the cut-short duration (D-082); writes `document_close` |
| `lockFrame(actor, runId, { decision, assumptions[3], position, confidence })` | State `framing`; validation (FR-040); inserts `run_frames`; `frame_locked` event; `confidence_at_frame`; transition to `working`, `working_started_at = now` (FR-041) |
| `saveBriefDraft(actor, runId, draft)` | State `working` only — `RUN_PAUSED`, `RUN_LOCKED` or `ILLEGAL_TRANSITION` by the state it refused; every field optional and every field held to the lock's own word limits, so a draft can never hold text the lock will refuse (`BRIEF_INVALID` naming the field, D-291); upserts `run_briefs` (unlocked); writes no trace event (FR-100) |
| `briefSignal(actor, runId, signal)` | The same gate; `{ opened: true }` → `brief_opened`, `{ closed: true, durationMs }` → `brief_closed`. A close that arrives after the auto-lock is refused rather than stamped later, because the working period ended at the expiry instant (D-294) |
| `lockDecision(actor, runId, brief)` | State `working` (`RUN_PAUSED` while paused); the order is fixed: validate (FR-100, FR-103), then `reliance.markReliedOnFromNamedFields` (FR-101), then `reliance.findUnstancedReliedOn`. A brief that breaks a limit → `lock_refused { reason: 'brief_invalid', field }` and `BRIEF_INVALID`, before either effect runs; an unstanced relied-on claim → `lock_refused { reason: 'unstanced_relied_on', … }` and `LOCK_REFUSED_UNSTANCED_CLAIM { claimId, claimText }` (FR-084, FR-108). Both refusals **commit** their event and the reliance already marked, and are raised afterwards (D-293). Otherwise `decision_locked` event (payload in §10, `relied_on_claim_ids` from `reliance.findReliedOn`, D-292), `confidence_at_lock`, `speed_outlier` when the elapsed *working* time — wall time from the frame lock less every paused span — is under 240 s (FR-106, D-296), transition to `decision_locked`, `turn_due_at = now + turn_delay_seconds` (FR-102, FR-110) |
| `addAddendum(actor, runId, { text })` | `decision_locked_at` set, `turn_locked_at` **not** set, and the run not `voided` — read from the columns rather than a state list (D-295 as D-363 corrects it: the window opens at the Decision Lock and closes when the Turn ends and the defense opens, not at `recorded`); ≤ 50 words and not empty; one per run (`ADDENDUM_EXISTS`); outside the window `ILLEGAL_TRANSITION` with `details.state`; `addendum` event (FR-107) |
| `getTurn(actor, runId)` | Materializes — which is what *delivers* the Turn for a student who navigated straight here; then the window, read as `isInTurnWindow` reads it: `turn_open`, or `paused` from inside the window, because a pause freezes the window rather than ending it and the run's next step is still the Turn (D-133, D-367). Anywhere else `TURN_NOT_OPEN` with `details.state`. Returns the turn text and voice, the window end and a server reading of what is left in it, and the frozen pre-Turn record (frame, locked brief, named fields). It carries **no claims and no `window_claim_ids`** (D-336): the claims the delivery surfaced (`surfaced_by: turn`, relied on by rule, FR-111, D-077) are read from `GET /runs/{runId}/claims`, the shape that carries a stance, the actions and the escalation reply, and `ClaimView.inTurnWindow` marks them — the same composition the workspace makes (D-268) |
| `respondToTurn(actor, runId, { response, justification, confidence })` | State `turn_open` (`TURN_NOT_OPEN` with `details.state`); then FR-112's rules — one of the three categories, a justification of 1 to 150 words once markup is stripped, and a confidence 0 to 100, all three required (`VALIDATION_ERROR` with `details { field, reason }`, D-335); then the gate: every claim the window *newly surfaced* stanced (`TURN_CLAIMS_UNSTANCED` with `details.claimIds`, from `reliance.findUnstancedWindowClaims` over `run_claims.in_turn_window`, D-337). The refusal is thrown rather than committed — it writes nothing, so there is nothing to preserve (unlike D-293's lock refusal). Otherwise `turn_response_locked` event, `run_turn_responses` row, `confidence_after_turn`, and the transitions `turn_open → turn_locked → defense_pending` in one transaction (FR-112) |
| `getDecision(actor, runId)` | The frozen record UI-024 reads (D-302): the run, the locked frame, the filed brief with its named fields, the addendum, whether one may still be written, the milliseconds until the Turn, and the Turn response once it has locked. It is the **one** read of that record: the defense's artifacts panel is the same four rows one state later (UI-026), so `defense.openDefense` composes this rather than building a second answer to "what did this student decide" (D-341). Owner only; materializes timers first, and refuses a run with no `decision_locked_at` as `ILLEGAL_TRANSITION` with `details.state` |
| `markDefenseOpened(tx, run, at)` / `markDefenseComplete(tx, run, { at, actorId, nothingAnswered })` | The two `runs` columns the defense moves, written here because the state machine and `runs.flags` are this module's (12 §8.1 keeps `flags` out of every student payload). The first stamps `defense_opened_at` once and writes no event of its own — what the open records is the interview it selected. The second is `defense_pending → defense_complete` with its `lifecycle` event, `defense_completed_at`, `scoring_status = 'queued'` and `flags.nothing_answered`; the *rule* for that flag stays in `defense`, which owns the answers (10 §9, D-345) |
| `pauseRun(run, cause, related)` / `resumeRun(actor, runId)` | See `10-backend-spec.md` §10; resume allowed by the student from the paused overlay; `resume` credits the cost (FR-001) |
| `voidRun(actor, runId, { reason, reoffer: boolean, variantId? })` | `requireRunInstructor`; any state except `voided`; `run_voided` event; transition; if `reoffer`: create a new run for the same student on `variantId` (default: the other variant; if the family has only two variants and the other is in use, a fresh run on the same variant), link `re_offered_from/to`, `run_reoffered` event on the new run; audit (FR-002, FR-008, FR-183) |
| `forceAssistantFailure(actor, runId)` | `requireRunInstructor` **first**, then `flags.testControls` (`TEST_CONTROLS_DISABLED`), so a student on the section learns nothing about the deployment; sets `flags.forced_failure_armed = true`; audit `test_control.force_failure`; no trace event — what the run records is the outage (FR-118) |
| `materializeTimers(run)` | `10-backend-spec.md` §8 |
| `listMyRuns(actor)` | Student runs with state and labels |
| `getRunStatus(actor, runId)` | State, scoring status (`held` → under review), links |

Repository: `insertRun`, `findRunForUpdate`, `findRunFull`, `updateRun`, `nextAttemptNo`, `insertReadinessAnswer`, `listReadinessAnswers`, `insertReadinessResult`, `insertDocumentOpen`, `closeDocumentOpen`, `insertFrame`, `upsertBriefDraft`, `lockBrief`, `insertAddendum`, `findRunTurn`, `insertTurnResponse`, `insertPause`, `resumePause`, `listRunsForStudent`. `findRunTurn` selects four of `scenario_turns`' nine columns — id, text, voice and `window_claim_ids`, the last of which never leaves the service — so `warrants_change`, `proportionate_response`, `evidence`, `disrupted_assumption_keys` and `stakeholder_id` are never loaded rather than loaded and dropped (12 §8, D-336).

Errors: `RUN_ACTIVE_EXISTS` (409), `ILLEGAL_TRANSITION` (409), `FRAME_INVALID` (400, details.field), `BRIEF_INVALID` (400, details.field), `LOCK_REFUSED_UNSTANCED_CLAIM` (409, details `{ claimId, claimText }`), `RUN_LOCKED` (409), `CLOCK_EXPIRED` (409), `ADDENDUM_EXISTS` (409), `TURN_NOT_OPEN` (409), `TURN_CLAIMS_UNSTANCED` (409, details.claimIds), `READINESS_SKIP_NOT_ALLOWED` (409), `TEST_CONTROLS_DISABLED` (403), `RUN_PAUSED` (409, for writes other than resume).

Edge cases: browser closed during `working` keeps the clock running (FR-117); a document open without a close is closed by the next open or by a lock the *student* pressed, with `duration_ms` bounded at a day and cut short by the clock only when the clock ended inside the open (D-249, D-250). The auto-lock closes none: the clock ran out on a student who may still be reading, and closing at the expiry instant would read the skim flag off the part of the open the clock saw, so the open stays open for the late close `closeDocument` accepts in any state (D-299). Lock during `paused` is refused (`RUN_PAUSED`).

## 7. `assistant`

**Responsibilities.** Delegations, trigger matching, claim surfacing, connective text, numeric guard, used marks, why lines, outside-tool declaration, Sycophancy Probe reversal (FR-050 to FR-056, FR-060 to FR-064, AI-002, AI-004, D-030, D-068, D-088).

| Service function | Rules and events |
|---|---|
| `delegate(actor, runId, { request }): AsyncIterable<DelegationChunk>` | State `working` or `turn_open` (else `ASSISTANT_LOCKED`); request ≤ 2000 chars; rate bucket `llm`; if `flags.forced_failure_armed` → clear the flag, pause the run with cause `assistant_failure`, throw `ASSISTANT_UNAVAILABLE` (FR-118); charge no clock; `first_delegation_at` set if null; match triggers (`triggers.ts`: deterministic then AI-004 per D-030) against **every** claim of the run's version; a claim already surfaced is carried again in the reply and referenced by the new delegation, and `surfaceClaims` writes no second `run_claims` row for it (D-267); if the probe claim is matched, the student holds `challenge` on it, and no earlier delegation of this run carries the `probe` flag, the authored reversal is spliced in front of the assembled reply as its opening prose and `probe_fired` is written — there is no separate probe path, the provider is called either way, and the decision is taken inside the second transaction under the run's lock so it happens once (D-088, D-278); insert `run_delegations` row (empty response) in one transaction, read `assistant-reply@1` from the provider with no lock held, then in a second transaction: **re-test the state gate under the run's lock**, marker check, numeric guard, defect-word filter, update the row, write `delegation` event, surface claims (`reliance.surfaceClaims(..., 'delegation')`) — the last four only when the run is still in the state the request was admitted against. A run that moved on while the provider was answering — a Decision Lock in a second tab, another component's failure, the run's own auto-lock materialized by the lock itself — discards the reply instead: nothing is written to the run (no event, no surfacing after FR-084's lock gate, no pause, no clock), the row keeps the request and takes the `discarded_late` flag with one sentence saying no answer reached the student, and the call answers `ASSISTANT_LOCKED` with the new state (D-280). The reply is guarded **before** the first `segment` event is written, because both guards read the whole reply and the filter's replacement has to happen before the words reach the screen (11 §3); the function therefore answers a *promise of* an `AsyncIterable`, so every refusal is settled before the response headers are (D-271); on provider failure: mark `failed`, pause the run with the delegation id, write `delegation` event with `failed: true` (FR-001) |
| `listDelegations(actor, runId)` | Log view: request, response, claims with current stances, why, flags, used marks (FR-060). The reviewer reads it in every state — it is the record. The owner's read is gated by `trace.requireOwnerReadAccess`, so the log is refused with FORBIDDEN from `turn_locked` through the defense and for a voided run, exactly as their trace is: it carries every request with its reply and the claims each raised, which is the room the defense takes away (UI-026, FR-120, D-279). The tier is not used here — `flags` and the `unverifiedNumbers` list stay off the owner's view in every state (D-269); the figures they name are marked inside `responseText` instead, which both readers carry (FR-052, D-281) |
| `updateDelegation(actor, runId, delegationId, { why?, usedClaimIds? })` | State `working` or `turn_open` (`RUN_LOCKED` after the Decision Lock); `why` ≤ 200 chars, stored on the row and written to no event — the `delegation` event was written when the reply landed and is immutable, so the row is the live value the log and the band read take (D-272); marking used writes `claim_used { via: 'log_mark', delegation_id }` and adds `log_mark` to `relied_on_via`, additively — a mark is not taken back, because a route that removed reliance would be a way past the lock gate of FR-084 rather than through it (D-270) |
| `declareOutsideTool(actor, runId, { purpose })` | Any state from `working` to `defense_pending`; `outside_tool_declared` event; no other effect (FR-061) |
| `flagDelegation(actor, runId, delegationId, flag)` | Reviewer; adds `out_of_scenario`; excluded from Delegation reads (FR-055) |

Trigger matching (`src/lib/trigger-match.ts`, wrapped by `triggers.ts`): `normalize(text)` = NFKD, lower-case, strip punctuation, collapse whitespace; a claim matches when any `trigger_phrases[i]` appears in the normalized request as a whole run of tokens, or every token of the phrase appears in the request's token set. Both branches compare whole tokens, so a phrase inside a longer word is not a match (D-260), and a candidate whose author wrote no phrases matches nothing. With `TRIGGER_MATCHING=llm_first` the classifier runs first and the deterministic match is the fallback; the mock answers `trigger-classify@1` by calling `matchTriggerPhrases` itself, so the switch changes the path and not the outcome (D-263).

Assistant reply assembly (`src/server/llm/guardrails/segments.ts`): `segmentReply(reply, claims)` alternates `{ type: 'text', text }` and `{ type: 'claim', claimId, text }` items in the order the model placed markers, where a claim segment carries the *authored* claim text and is consumed from the reply only when it follows the marker verbatim; missing markers are appended as claims first. Both guards read text segments only, so a claim's authored text cannot be flagged or redacted (D-264). The world summary passed to the prompt is the brief plus stakeholder names and roles (never positions or blind spots verbatim beyond what documents say).

Repository: `insertDelegation`, `completeDelegation`, `failDelegation`, `listDelegations`, `updateDelegation`.

Errors: `ASSISTANT_LOCKED` (409), `ASSISTANT_REQUEST_TOO_LONG` (400), `ASSISTANT_UNAVAILABLE` (503, run paused), `DELEGATION_NOT_FOUND` (404).

## 8. `reliance`

**Responsibilities.** Claim surfacing and student claim views, stances, interrogation actions, escalations, relied-on detection, lock gate (FR-070 to FR-075, FR-080 to FR-087, FR-090 to FR-093, D-076, D-077, D-089).

| Service function | Rules and events |
|---|---|
| `surfaceClaims(tx, run, claimIds, by, byId)` | Inserts `run_claims` rows for new claims with `surfaced_by`, `in_turn_window`; in the Turn window sets `relied_on_via += turn_window` and writes `claim_used { via: 'turn_window' }` (D-077) |
| `surfaceDocumentClaims(tx, run, documentId)` | Claims with `source_kind = document` and `source_document_id = documentId` (FR-031) |
| `listRunClaims(actor, runId)` | Gated by `trace.requireOwnerReadAccess` — the claim table with its stances is the room, so it is refused with FORBIDDEN wherever the trace and the Delegation Log are (D-279). Student view: id, key, text, surfaced by, stance, previous stance, available actions (each of the three when the run variant's confirmed `verification_paths` names it — including `source_trace`, which is the same set as "has a source document" for any confirmable package and is the only reading that can return the authored result FR-070 requires; corrected with D-284), whether the student may escalate now (`canEscalate`, from the run's remaining escalations — never the claim's authored `escalatable`, D-244), the escalation reply if they escalated, actions run with results; never warranted stance or evidence status |
| `setStance(actor, runId, claimId, stance)` | State `working` or `turn_open`; claim surfaced; `previous_stance` kept; `action_ids` = actions on the claim so far; `stance_set` event; if `stance = escalate` the client must call `escalate` (the stance is recorded; the escalation charge happens in `escalate`) (FR-080, FR-085) |
| `runAction(actor, runId, claimId, type)` | State `working` (clock > 0, `CLOCK_EXPIRED`) or `turn_open` (window remaining > 0, `TURN_WINDOW_EXPIRED`); type available for the claim (`ACTION_NOT_AVAILABLE`); charge the cost first (`chargeCost` on the working clock, or the window deduction of `10-backend-spec.md` §10 in the window, D-132), then return the authored result from `verification_paths` verbatim, in the author's own keys (FR-070 to FR-073, D-284); `action` event |
| `escalate(actor, runId, claimId, { statement })` | State `working` (clock > 0) or `turn_open` (window remaining > 0) — checked **before** the statement, so a closed room answers for the room and not for the sentence (D-331); statement 3 words to 280 chars (D-089); **every escalation counts against the run's two, whichever claim it lands on** — `ESCALATION_LIMIT_REACHED` when 2 have been spent, on every surfaced claim alike (D-328). The claim's `escalation_reply` decides only *which reply answers*: `response_id = 'claim'` with `counts_against_limit = true` when it has one, `general`/`false` when it does not, and the pair is bookkeeping for the reviewer rather than a rule. FR-091's "does not count against the limit" is deliberately not implemented: it made the counter and the refusal a function of which claims carry an authored reply, which is the same set as the claims worth escalating (D-328). Charge 300,000 ms on the working clock or the window (D-132); sets stance `escalate` if not already, with its own `stance_set` event, because the graphs are built from the trace (D-285); `escalation` event |
| `markReliedOnFromNamedFields(tx, run, namedValues)` | For each named value, claims whose `carried_values` match by D-076 → `relied_on_via += named_field`, `claim_used { via: 'named_field', field_key }` (FR-101) |
| `findUnstancedReliedOn(tx, run): RunClaim[]` | `relied_on = true and stance is null`, ordered by `surfaced_at` (FR-084) |
| `findUnstancedWindowClaims(tx, run): RunClaim[]` | `in_turn_window = true and stance is null`, same order: FR-111's gate on the Turn response, over the set FR-111 names — the claims the window *newly* surfaced, whether by the Turn itself or by a delegation or document open inside it. It is here and not in `runs` because `run_claims` is this module's table (D-292, D-337) |
| `findReliedOn(tx, run): RunClaim[]` | `relied_on = true`, same order: the whole set the Decision Lock records as `relied_on_claim_ids`. It is here rather than in `runs` because `relied_on_via` is this module's column and a second reader would be a second definition of "relied on" (D-292) |
| `stanceMatrixInput(run, events, package)` | Used by scoring: rows for every consequential claim in the variant (surfaced or not; unsurfaced rows are `not surfaced`) |

Repository: `upsertRunClaim`, `listRunClaims` (filterable by `reliedOn`, `inTurnWindow` and `unstanced` — the two gates' sets), `findRunClaim`, `setStance`, `insertAction`, `listActions`, `insertEscalation`, `countEscalations` (every row of the run, not the `counts_against_limit` subset — D-328), `updateReliedOn`.

Errors: `CLAIM_NOT_SURFACED` (409), `ACTION_NOT_AVAILABLE` (409), `CLOCK_EXPIRED` (409), `ESCALATION_LIMIT_REACHED` (409), `ESCALATION_STATEMENT_INVALID` (400), `STANCE_INVALID` (400). The last two are raised by the service rather than by the wire schema, so they hold for every caller (D-287); `TURN_WINDOW_EXPIRED` comes from `runs/clock.ts`'s `chargeCost`, and the state gate answers `RUN_PAUSED` (409), `RUN_LOCKED` (409) or `ILLEGAL_TRANSITION` (409) by the state it refused. `CLOCK_EXPIRED` is not among them from Step 8.2 onward: a working clock at zero auto-locks the decision (10 §8 branch 2) and `lockRunForMutation` materializes that before this module reads the state, so the refusal a student meets is `RUN_LOCKED` (D-300).

## 9. `defense`

**Responsibilities.** Question selection, rendering, follow-ups, answers, completion (FR-025, FR-120 to FR-126, D-031, D-080, D-090, D-339 to D-345).

| Service function | Rules and events |
|---|---|
| `openDefense(actor, runId)` | State `defense_pending` or `defense_complete` for the read; on first open (in `defense_pending`): select questions (below), insert `run_defense_questions`, write `defense_question` events, stamp `defense_opened_at` through `runs.markDefenseOpened`, all under the run's row lock so two tabs select one interview. Returns `DefenseView = { questions, artifacts }`: the questions in `seq` order with their answered state and the answer already given (FR-126), and the artifacts — frozen frame, locked brief, addendum, Turn response, named fields — read through `runs.getDecision`, the one read of the frozen record (D-341). No assistant, no documents, and no `run` on the shape: UI-026's `RunFrame` composes `GET /runs/{runId}` beside it as UI-023 and UI-024 do (D-268, D-336). A run outside the two states answers `DEFENSE_NOT_OPEN` with `details.state`, including the run with no filed decision that `getDecision` refuses in its own terms (D-345) (FR-120, FR-126) |
| `answerQuestion(actor, runId, runQuestionId, { text, durationMs })` | State `defense_pending`; markup stripped then ≤ 5,000 chars (`VALIDATION_ERROR` with `details { field, reason }`, D-287); `durationMs` clamped to 0…86,400,000 rather than refused, because `run_defense_answers.duration_ms` is an `integer` and a client measurement is not worth losing an answer over (D-362); insert answer; `defense_answer` event; then follow-up rule: if the question is not itself a follow-up, has no follow-up yet, **the run has not already been asked this bank row's follow-up** (D-366), the author wrote one, and (deterministic trigger D-031 or verbatim-brief rule D-090) → insert the follow-up question (`follow_up_of`, at the next free `seq`), `defense_question` event (D-344). **`run_defense_questions.question_id` is not unique per run and must not be keyed on**: `figure_provenance` draws one question per unsourced figure in the brief and they all reuse the single bank row D-135 requires, so a run's questions are identified by `run_defense_questions.id` and ordered by `seq`. Returns `{ next, followUpQuestion }` — `next` is the first question still unanswered and skips the follow-up, which travels in its own field because UI-026 draws it beneath its parent. It is `followUpQuestion` and not `followUp` because `student-view.ts` reserves that name for the bank's authored prompt (D-343) (FR-123, FR-124, FR-125) |
| `completeDefense(actor, runId)` | State `defense_pending`; all questions answered (empty answers allowed and counted; `DEFENSE_INCOMPLETE` with `details.unanswered` = how many have no answer row). A defense that was never opened has no interview to finish and answers `DEFENSE_NOT_OPEN` rather than completing vacuously (D-345). `nothing_answered` flag when every answer is empty or under 3 words; transition to `defense_complete` with `defense_completed_at` and `scoring_status = 'queued'` through `runs.markDefenseComplete`, which owns the state machine and `runs.flags`; enqueue `score_run` after commit (D-046) |

Selection (`selection.ts`, pure over events + bank + package). The events are the run's trace as written, read through `trace.readEvents`: every fact the seven conditions need is in it, and it is the only place all of them are in one order — which is also what gives each rendered question its `selecting_event_seq` (D-340). Surfacing has no event of its own, so "surfaced" is the first of `document_open` on the claim's source document (FR-031), `delegation.claim_ids` and `turn_delivered.window_claim_ids`.

1. Candidates in order: `provenance` for each consequential claim relied on with no `source_trace` action (load-bearing first, then by surfaced time); `figure_provenance` for each named field value that matches no claim and no document number (FR-025); `verification` for each claim with `previous_stance` not null and an action before `stance_set_at`; `assumption` for each frame assumption index whose normalized token overlap with the brief assumptions ∪ Turn justification is < 0.5, or all three when the response is `reverse`; `confidence` when `confidence_at_lock > confidence_at_frame` (D-080); `frame_vs_response` when a non-implicit Turn response exists (D-106); `counterfactual` for each counterfactual question whose named field was entered — `condition.named_field_key` names it, and a question that names none is selected when the student entered any named value at all (D-339).
2. Take the first 9.
3. If fewer than 6, append `default` questions in position order until 6.
4. Render templates with `{claim_text}`, `{figure}` (the named value with unit, through `defense.figure*` in `en-US.ts`), `{stance}`, `{document_title}` (source document), `{assumption}`. A placeholder the run cannot supply renders as the empty string and the whitespace around it is collapsed, so no student ever reads a brace and no words the author did not write are put into a question they confirmed (D-342).

Nothing in any of the four steps reads `variant_claim_states`. Whether a question is selected, its kind, its place in the interview and its wording are a function of the student's own acts and of package fields the two variants share (`consequence_level`, `importance`, `source_document_id`, `carried_values`, the room's documents, the bank), so no interview can say whether the run carries a defect or where.

Repository: `insertRunQuestions`, `listRunQuestions` (joined to `defense_questions` for the `kind` the rendered row does not store), `nextQuestionSeq`, `insertAnswer`, `findRunQuestion`, `findFollowUpTexts`; and the package reads selection is drawn from — `findRunPackage`, `listVersionClaims`, `listVersionDocuments`, `listVersionNamedFields`, `listQuestionBank` — each naming its columns, so `expected_answer_notes` and `variant_claim_states` are never loaded rather than loaded and dropped (12 §8, D-242).

Errors: `DEFENSE_NOT_OPEN` (409), `QUESTION_ALREADY_ANSWERED` (409), `DEFENSE_INCOMPLETE` (409, details.unanswered).

## 10. `trace`

**Responsibilities.** Append-only events, sequencing, reading, the two export forms, the claim table (FR-007, FR-240 to FR-243, NFR-005).

| Service function | Rules |
|---|---|
| `append(tx, run, type, payload, { actorId?, occurredAt? })` | Takes `run.next_event_seq` (row locked) by compare-and-set and increments the allocator. `clock_remaining_ms` is `remainingMs` (or the window remaining) of the run row **as the transaction returns it from that same statement**, never of the caller's copy: a mutation that charges a cost or transitions before appending must stamp the post-write reading, and `TraceRun` therefore carries only `id`, `organization_id` and `next_event_seq`, so a stale clock is not a value a caller can pass |
| `listEvents(actor, runId)` | A reviewer receives the trace exactly as written, sequence included — it is the record. The owner's view is governed by `owner-view.ts` and three rules: (a) **run state** — `open` for `assigned`…`turn_open`, `sealed` for `turn_locked`, `defense_pending`, `defense_complete`, `voided` and the future-state states (FORBIDDEN; the defense is what the student can say with no room in front of them, UI-026), `scored` for `scored`, `confirmed`, `recorded`; (b) **fields**, picked (never deleted, 12 §8) from a per-type table the compiler requires to classify every payload field as `owner`, `after_scored` (D-117's "never before the run is scored") or `reviewer_only`; (c) **sequence**, renumbered densely 1..N over the events they can see, because `probe_fired` is withheld and the stored numbering would leave a hole exactly where the probe fired (FR-053, D-088) — for the same reason `defense_question.selecting_event_seq`, `draft_band.evidence_event_seqs` and `draft_band.quotes` are `reviewer_only`. This replaces the earlier "the owner view omits nothing", which was never true |
| `readEvents(runId, dbx?)` | The record as written, for a pipeline **inside the server** rather than for a reader: the defense's question selection (10 §9) and Phase 10's scoring build from it. The third seam other modules take from this one, alongside `append` and `requireOwnerReadAccess`; it is reached with a run id the caller's permission helper has already resolved and applies no view rule of its own (D-340) |
| `requireOwnerReadAccess(tenantId, runId)` | Rule (a) above, alone and exported. The Delegation Log (`GET /runs/{runId}/delegations`) and the claim table (`GET /runs/{runId}/claims`) are the same room in two other shapes, so both ask this rather than keeping a state list of their own — a student refused their trace in `defense_pending` and served their delegations in the next tab has been handed back exactly what UI-026 takes away. Answers the tier (`open` or `scored`) for a caller with fields of its own to gate, and throws FORBIDDEN with `details.state` when the answer is `sealed` (D-279) |
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

Repository: `insertEvent`, `allocateSeq` (compare-and-set on `runs.next_event_seq`, returning the sequence and the run's clock columns), `findRunState`, `listEventsForRun`, `listEventsByType`.

Errors: `SEQUENCE_CONFLICT` (500, **not** retried). The gapless sequence comes from the compare-and-set in `allocateSeq` plus the fact that a rolled-back transaction takes its allocation with it; the run row lock is what makes a contending mutation *wait* and arrive with a fresh allocator rather than fail. So a mutation that held the lock cannot raise this, and every case that does is a caller defect — an append without `findRunForUpdate`, or a second append from a stale copy of the row. `withTransaction` has no retry and gains none: re-running an arbitrary side-effecting callback to paper over a caller defect would hide it, and this is a 500 so it reaches Sentry and gets read. The earlier "retried once inside the transaction wrapper" described a retry that never existed.

`FORBIDDEN` (403) when the run's own student asks for the trace in a `sealed` state (see `listEvents` above); it is one of the global codes of 07 §1, so the endpoint's contract in 07 §7 is unchanged.

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
