# Evals

The regression net for every prompt in `src/server/llm/prompts`. Three suites, 33 cases, run through
the same registry the application calls, so what they measure is the provider a student would meet.

| Suite       | Cases | What it asks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assistant` | 16    | One delegation each — matched, paraphrased, unmatched, a request for the whole answer, a self-audit attempt, six injection attempts. Does the reply surface exactly the matched claims, mark each once, carry the claim text as the author wrote it, keep the defect words out of the model's own prose, invent no figure and mark every one the guard flags, hand the student every surfaced claim whatever the model did, and follow nothing an attacker planted?                                                                |
| `authoring` | 4     | One licensed seed each, through all seven generation steps **as the pipeline runs them** — the step’s own rule subset after each answer, then one more pass with the broken rules restated (D-676). Does the package the seven answers make pass `validatePackage`, hold the three document roles, six claims, a walkable Source Trace on the planted claim, a sound claim warranted Accept, 6/4/6 readiness items, a non-empty re-skin log — and did the licensed case’s proper nouns stay out of everything but the seed record? |
| `scoring`   | 13    | One PRD-fixed placement each (FR-139), through the whole scoring pipeline: trace, graphs, categorical facts, five band reads from the provider, drafted bands, points. Does the placement the PRD fixed by hand survive a model?                                                                                                                                                                                                                                                                                                   |

Spec: `docs/tech/11-llm-integration.md` §5. Thresholds: `evals/config.ts`.

## Running

```bash
pnpm evals                 # every suite
pnpm evals assistant       # one suite; `authoring` and `scoring` likewise
```

With no environment of its own, `pnpm evals` runs on the **mock** provider — `FEATURE_AI` is `false`
by default in every environment — and the threshold is **100 percent**. The mock is a pure function
of its input (§1.4), so every case has exactly one right answer and it never moves: a single failing
case is a regression in a prompt, a guardrail or a matcher, never noise. This is what CI runs.

### Against the real provider

```bash
FEATURE_AI=true LLM_PROVIDER=openai-compatible pnpm evals
```

Needs `LLM_API_KEY` in `.env` (MiMo, from <https://platform.xiaomimimo.com/#/console/api-keys>);
`LLM_BASE_URL` and `LLM_MODEL` already point at MiMo-V2.5-Pro. Nothing else changes: no flag is set
anywhere but this shell, and the repository's committed default stays `FEATURE_AI=false`.

The threshold is **90 percent of cases**. A real model phrases its connective sentences differently
on every call, and the checks are properties rather than string equality; a tenth of the suite
failing means a prompt has drifted from what the product promises.

Three practical notes.

- **It costs money and time.** A full run is roughly 120 model calls — 16 for `assistant`, 28 for
  `authoring` (seven steps × four cases, plus any repair call), about 70 for `scoring` (five band
  reads × thirteen cases, plus the second pipeline the hold-equals-revision case runs). Measured on
  MiMo-V2.5-Pro in step 14.4: about 100 calls and $0.10 for a run whose `authoring` suite failed
  early, so a whole one lands well under a dollar. **Time is the real cost.** A delegation answers in
  3 to 13 seconds and a band read in 3 to 13, but the model writes about fifty output tokens a
  second, so a generation step that writes an Evidence Room takes one to three _minutes_ — `authoring`
  is nearly all of the wall clock. Expect the better part of an hour.
- **It writes `llm_calls` rows** under `feature = 'eval'`, so eval traffic is never counted as
  student traffic, and it spends the same monthly token budget everything else does (D-065). The
  ground-truth SQL in `docs/tech/13-observability-ops.md` §6.3 is what to read afterwards for what
  the run actually cost:
  `select count(*), sum(input_tokens + output_tokens), sum(cost_estimate_usd) from llm_calls where feature = 'eval' and created_at > now() - interval '2 hours';`
- **Run it once, read it, fix, run it again.** Re-running to see whether a case passes this time is
  measuring variance, not the prompt.

## Reading the report

```
tassl evals — provider openai-compatible (FEATURE_AI=true, LLM_PROVIDER=openai-compatible, TRIGGER_MATCHING=deterministic_first)
threshold 90.0% of cases

assistant
  pass  01-matched-single-claim — A request that matches one claim
  FAIL  08-whole-answer-request — A request for the whole recommendation
      ✗ no_unsourced_numbers: 1 number(s) the model wrote from nowhere: 4.2 (1 unverified in all)
      output 9f2c…  (64 hex characters)
  16/16 cases
…
33/33 cases (100.0%), 274/274 checks — PASS
```

- A **case** passes only when every one of its checks passes; the percentage at the bottom is cases,
  and it is what the threshold is applied to. The check count beside it is a finer-grained read of
  the same run — 274 of 274 and 33 of 33 say the same thing from two distances.
- A **failing case** prints the checks that failed and then `output <sha256>`: the digest of the raw
  text the provider returned for that case (for `authoring`, of all seven steps' raw answers in
  order; for `scoring`, of the five rationales).
- **No prompt or completion text is ever printed** — not here, not in a log line, not in CI (§5,
  D-661). Every `detail` is a check name, an id, a count, a band, a rule code, or a number the
  numeric guard objected to. That is deliberate: the model's prose is written over a package's
  internals and a student's fixture writing, and this report gets pasted into pull requests and CI
  logs. The digest is what identifies an answer instead.
- The digest is for **recognition, not decryption**. Two runs that produce the same digest produced
  the same answer, so it tells a flapping case from a stable failure and tells whether a prompt
  change moved anything. To see the answer itself, reproduce the case locally under a debugger or a
  temporary `console.log` in your working tree — never in a commit.

Exit code is 0 at or above the threshold and 1 below it.

## What a failure means, and what to do about it

**A failing case is a prompt bug until proven otherwise.** The fix is to change the prompt in
`src/server/llm/prompts/` and **bump its `version`** — the version is on every `llm_calls` row and
every `llm_call` event, so a prompt that changed without one makes two different prompts
indistinguishable in the operations panel. Then run the suite again.

**Never lower a threshold to make a run pass.** `MOCK_PASS_RATE` and `REAL_PASS_RATE` in
`evals/config.ts` are the product's promise about the assistant, not a dial. If a case cannot be
made to pass, leave the threshold where it is and record the case, its digest and the diagnosis in
`docs/tech/DECISIONS.md`.

**And never weaken a check to make a case pass — but do check that the check is the promise.** The
two are not the same thing, and the difference is whether you can name the property the new form
proves and point at where the product promises it. `no_unverified_numbers` failed real-provider
cases on figures the model had read out of the scenario summary, which FR-052 does not forbid and
D-068 deliberately marks rather than blocks; it was replaced by `no_unsourced_numbers` and
`unverified_numbers_marked`, which are the two things FR-052 and D-068 actually say, and kept as it
was on the mock, where §5 puts it (D-670). `hold-equals-warranted-revision` asserted that one
justification bands the same read as a hold and as a revision, which is not what PRD §7.11 says and
which no competent reader could satisfy — six paired runs agreed zero times (D-674). Both of those
are recalibrations with a citation. A threshold moved, an assertion softened to `>=`, a case
deleted, or an expectation loosened to whatever the last run produced is not.

Where the failing check points:

| Check                                                  | What it means                                                                                                                                                                                                                               | Where the fix usually is                                                                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `surfaced_claims`                                      | The trigger matcher, not the model, chose the wrong claims                                                                                                                                                                                  | `src/server/modules/assistant/triggers.ts`, or the case's `triggerPhrases` in the fixture. On a real provider it can also be `trigger-classify` (D-263), which is a prompt |
| `markers_once_per_claim`, `claim_text_verbatim`        | The model paraphrased a claim or dropped a marker. The workspace turns a marker into a stanceable card, so this is a claim the student was told about and cannot stance                                                                     | `assistant-reply`'s marker rules                                                                                                                                           |
| `no_defect_words`                                      | The model's own prose used a word from `guardrails/defect-words.ts` (FR-056). The guard redacted it, so nothing leaked to a student — but a reply full of `[…]` is a bad reply                                                              | `assistant-reply`'s "what you never do" block                                                                                                                              |
| `no_unsourced_numbers`                                 | The model wrote a figure that is in neither D-068’s allowed set nor the framing the student can see: it invented it, or it put a numeral in front of a point (FR-052, D-670). A figure quoted out of the brief is marked rather than failed | `assistant-reply`’s numbers rule, or its prose rule for an enumerator                                                                                                      |
| `unverified_numbers_marked`                            | A figure the guard flagged did not reach the reply the student reads with its `[[figure:…]]` mark, or a mark arrived that the guard never made (D-068, D-281)                                                                               | `guardrails/numeric-guard.ts` and `segments.ts`, not the prompt                                                                                                            |
| `every_surfaced_claim_reaches_the_student`             | A claim the trigger matcher surfaced is missing from the reply `assembleReply` returns. The model dropping it is a prompt bug; it being absent _after_ the rebuild is a guard bug (D-672)                                                   | `guardrails/assemble.ts` first, then `assistant-reply`’s marker rules                                                                                                      |
| `no_instruction_echo`, `no_instruction_leak`           | An injection worked, or the system rules came back in the reply                                                                                                                                                                             | The `untrusted()` wrapping and the system rules (§2, D-067)                                                                                                                |
| `passes_validate_package`                              | The generated package broke one of 10 §4's rules; the detail is the rule codes                                                                                                                                                              | The generation prompt that owns that element — the code names it                                                                                                           |
| `seven_steps_answered`                                 | A generation step never produced a valid answer after its one repair **and** the pipeline’s one further pass with the broken rules restated (D-676) — four calls, not one                                                                   | The output schema in that step’s prompt, usually a field the model cannot satisfy as described                                                                             |
| `licensed_case_did_not_survive_the_reskin`             | A proper noun of the licensed case is somewhere outside the seed record. The detail gives the position in that case's `mustNotAppear`, so look the phrase up in `evals/authoring/cases/*.json`                                              | `gen-reskin-brief-stakeholders`                                                                                                                                            |
| A band placement                                       | A band read moved a placement the PRD fixed by hand                                                                                                                                                                                         | The `band-read-*` prompt for that dimension                                                                                                                                |
| `every drafted band cites the events it was read from` | A read returned a rationale with no evidence (FR-137)                                                                                                                                                                                       | The same prompt's citation rule                                                                                                                                            |

## Adding a case

Drop a JSON file in `evals/<suite>/cases/`; the loader reads the directory in sorted order and the
Zod schema at the top of each `check.ts` is the file format. A new case must pass on the mock —
`MOCK_PASS_RATE` is 1 — which means the mock's deterministic answer has to satisfy every check, so a
case that only a real model could pass belongs in the real-provider run and nowhere in CI.
