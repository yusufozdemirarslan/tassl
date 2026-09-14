# What Tassl is

Read this first, whatever your role. It explains what the app does, who the four kinds of user are,
how one decision travels from a blank assignment to a number in your own gradebook, and the promises
Tassl makes about what it will never do. Every other file in this manual assumes you have read this
one.

## What the app does

A student opens one business situation and has to decide something real about it, once, with an AI
assistant sitting in the room and a clock running. Tassl records what they did and shows their
instructor the recording.

Here is the whole of it, in order:

1. The student reads a written situation — the **Scenario brief** — and as many dated documents as
   they like in the **Evidence Room**. Nothing is summarized for them and nothing suggests an order.
2. Before the assistant is switched on, they write their **frame**: **The decision**, three
   **Load-bearing assumptions**, **Your position now**, and a confidence from 0 to 100. Then they
   press **Lock the frame**. That text is frozen for good — it is never edited again by anyone, and
   the assistant unlocks only once it is locked.
3. The **Working clock** starts and the **AI assistant** opens. The student can ask it anything about
   the situation. Asking costs no clock time.
4. Everything consequential the assistant says arrives as its own card, headed **Claim C1**,
   **Claim C2** and so on, quoting the statement word for word. On each card the student must choose
   one of five positions under **Your stance**: **Accept**, **Verify**, **Challenge**, **Reject** or
   **Escalate**. They can also spend clock time on a check — **Source Trace**, **Replication Check**
   or **Decomposition Check** — or **Escalate** the claim to a colleague.
5. They write **Your decision brief**: a recommendation, the reasoning, three assumptions, what would
   change their mind, a confidence, and **The figures you are betting on** — the scenario's own
   named numbers. Then **Lock the decision**. Filing is irreversible. Tassl refuses to file it if the
   student leaned on a claim they never took a position on, and names the claim.
6. A short wait later **The Turn** arrives: a message from the world that undercuts part of what they
   just filed. The length of that wait belongs to the scenario package, not to Tassl — the seeded
   **Meridian Roast (fixture)** sets ninety seconds, and another package may set anything between
   sixty seconds and two minutes. The **Turn window** that follows runs twelve minutes, and they must
   **Hold**, **Revise** or **Reverse** and say why in 150 words.
7. Then **The defense**: six to nine typed questions drawn from their own run, with no assistant, no
   Evidence Room and no clock.
8. Tassl turns the recording into four graphs and drafts a level on each of seven dimensions.
9. The instructor reads the same graphs and the same recording, and confirms or changes each of the
   seven. The course turns the confirmed levels into points using its own conversion table.

The four graphs, named as the app names them:

| Graph | What it plots |
|---|---|
| **Confidence line** | The student's stated confidence at the frame, at the lock and after the Turn, against how accurate the claims they were relying on actually were. |
| **Clock timeline** | The working period and the Turn window cut into segments by activity — reading, delegations, checks, escalations, time in the brief — with every clock credit marked. |
| **Stance matrix** | One row per consequential claim: the stance taken against the stance the material warranted, what check came before it, and the **False Challenge Rate**. |
| **Frame beside decision** | The frozen frame set beside the filed brief and the Turn response, with the assumptions the Turn disrupted marked. |

The seven bands, in the order the app always lists them, are the levels placed on these seven
dimensions:

| Dimension | What it is about |
|---|---|
| **Framing** | The decision the student set themselves, and the assumptions it rests on. |
| **Delegation** | What was handed to the AI and what was kept. |
| **Verification** | Whether the checks they ran were relevant and could have changed the decision. |
| **Calibration** | Whether their reliance matched the quality of the advice, the stakes and the cost of checking. |
| **Decision Quality** | Whether the decision is defensible against the evidence available at the time. |
| **Adaptation** | Whether the response to the Turn was proportionate. |
| **Ownership** | Whether they can explain the decision, and the AI's part in it, unaided. |

Each of the seven carries one of four bands — **Novice**, **Developing**, **Proficient**,
**Professional** — or is marked **Unassessed**, which takes the dimension out of the arithmetic
rather than counting it as zero.

## Who uses it

| Who | What they are here for |
|---|---|
| Students | To take a Decision Run, and afterwards to read their **Run Debrief** and their **Judgment Record**. |
| Scenario Editors | To build a scenario package from a licensed seed case, read every element of it, and confirm the version that assignments will run on. They can also take runs, like any student. |
| Instructors | To set up courses, sections, rosters and assignments; to read each run back and decide its seven bands; and to carry the result into their own gradebook. |
| Platform Admins | To run Tassl itself: every account's role, deployment flags, the assistant switch and the audit log, with full access to everything else. |

## The roles, and how they fit together

Every account holds exactly one role. A Platform Admin sets it on the **Users** screen, and a new
account starts as a **Student**. Nothing else in the app grants a role: belonging to an institution
says *where* a person works, and a row on a section roster says *which* section they are on, but
neither says what they may do there.

| Role | What it can reach | Covered in |
|---|---|---|
| **Student** | **Home** and **Runs**, and every screen of their own runs — nothing else | [the learner manual](02-learner.md) |
| **Scenario Editor** | Everything a Student can reach, plus **Packages**: building, editing and confirming the scenario packages of their institution | [the scenario editor manual](04-scenario-author.md) |
| **Instructor** | **Home**, **Courses**, **Review** and **Packages** (to read), and every run in the courses they created or teach | [the instructor manual](01-instructor.md) |
| **Platform Admin** | Every screen, including **Admin**, in every institution, without belonging to any | [the platform admin manual](03-admin.md) |

**Student.** A student needs a row on a section's roster before a run can start; belonging to the
institution alone is not enough. They see the assignments of every section they are on, and their own
runs on them. They can never see another student's run in any form — it answers **Not found**,
exactly as a run that does not exist would.

**Scenario Editor.** A Scenario Editor has a Student's access — put on a roster, they take that
section's runs exactly as a student does — and, on top of it, the package shelf. They create a package
from a seed case, run the seven generation steps, edit and reject the elements the model drafted, and
confirm the version that freezes its text. They never reach a course, a roster, another learner's run
or the review queue.

**Instructor.** The instructor builds the teaching structure: courses, sections, rosters, invitations,
assignments, the outside-AI policy, the run weight and the band-to-points mapping. On the courses they
created or teach, they read every run back, decide its bands, void it, enter a correction or arm the
test outage. They read scenario packages — to choose a confirmed version for an assignment and to read
it back beside a run — but they do not build, edit or confirm one. An instructor does not take runs.

**Platform Admin.** A Platform Admin operates Tassl and has full access: every institution, course,
roster, assignment, package and run, without being a member of any of them. They alone set other
people's roles, the institution's settings and its data agreements; they flip the assistant between
**Live model** and **Scripted assistant**, and read the audit log. They cannot change their own role.

## The journey, end to end

This is the whole chronology. Each step names the role who acts, and what changes on everybody else's
screen.

**1. An institution exists.** A Platform Admin creates it and names one person as its first member;
that person must already have a Tassl account. There is no screen for this in the build, so in
practice the institution is already there when you arrive. *What changes:* the named person becomes a
member, and the institution's name appears in the header of everyone who belongs to it. In this manual
the institution is **Walkthrough University**.

**2. People get accounts and memberships.** Anyone can create an account at **Create your Tassl
account**, and it starts as a **Student**; an account that belongs to no institution lands on
**Home** reading **Waiting for an invitation**. An instructor presses **Invite to institution** on a
section roster, and the invitee opens the link and presses **Accept the invitation**. An invitation
carries no role — whatever the person may do comes from their own role, which a Platform Admin sets.
*What changes:* the inviter's **Invitations** panel gains a **Pending** row, then the invitee can be
put on a roster.

**3. A scenario package is authored.** A Scenario Editor opens
**Packages** → **New package from a seed case**, pastes the licensed case text, and runs
**Generate version 1**. The pipeline writes the elements in seven steps — **Re-skin, brief and
stakeholders**, **Evidence Room documents**, **Answer space and named fields**, **Claims and their
variant states**, **The Turn and the probe**, **Question bank and counterfactual**, **Readiness Check
items**. *What changes:* nothing is usable yet; the version sits on the shelf as a draft.

**4. The package version is confirmed and frozen.** The same Scenario Editor reads every element and
presses **Confirm**, **Reject** or **Rewrite** on each, ticks **Teaching note checked against the
answer space and claims**, and presses **Confirm version**. *What changes:* every instructor and every
other Scenario Editor in the institution gets the notification **A scenario package is ready to
assign**, and the version becomes selectable on
**New assignment**. The version's text can never change again; a change means a new version. In this
manual the package is **Meridian Roast (fixture)**, at version 1.

**5. An instructor creates a course.** **Courses** → **New course**, with a name and a **Term**.
*What changes:* the instructor's **Courses** panel on **Home** gains a row. Students see nothing yet —
there is no section and no assignment. Here the course is **Marketing Strategy Walkthrough**.

**6. The instructor adds a section and its roster.** **Sections** → **New section**, then **Roster** →
**Add member** with an email address. The roster row carries no role of its own; the **Role** column
shows the role the person's account already holds. *What changes:* an added **Student** or **Scenario
Editor** can now start that section's assignments. An added **Instructor** now teaches the course too,
and can open the replays of its runs; an instructor who neither created the course nor sits on one of
its rosters gets **Not found**. Here the section is named A.

**7. The instructor sets the policy, the weight and the mapping.** On the course's **Policy** view
they choose **Open**, **Declared** or **In-Environment Only**, set the **Default run weight**, and
list the **Taught concepts**. On the **Mapping** view they set what each band is worth — by default
**Novice** 1, **Developing** 2, **Proficient** 3, **Professional** 4. *What changes:* students read
the policy on the screen before every run. Changing the mapping later shows the instructor a
**What would change** preview first, then re-exports every confirmed run in the course and moves the
points on every affected student's debrief.

**8. The instructor publishes an assignment.** **Assignments** → **New assignment**: a name, the
section, a confirmed **Scenario package version**, a **Variant** (**Defective**, where one
consequential claim does not hold up, or **Sound**, where they all do), a **Working clock (seconds)**,
a **Weight**, the **Walkthrough** switch and an **Opens at** time. *What changes:* every student on
that roster immediately gains a row on **Runs** and in **Your runs** on **Home**, reading **Not
started** with **Start** beside it. The student is never told which variant they drew.

**9. The student starts the run and reads what it counts for.** They press **Start** and land on
**Before you begin**, which states **Run type**, **Weight**, the course's outside-AI heading, the
table under **What a confirmed band is worth**, the length of **The working clock** and what the
Readiness Check is. *What changes:* the run's **State** becomes **Readiness Check** on the
instructor's assignment table.

**10. The student takes the Readiness Check.** Sixteen short questions with an eight-minute limit. It
is not scored, it never blocks the run, and **Skip the check** is offered if it will not submit. It
closes with **What the check read** — one sentence per idea, with no score and no rank. *What
changes:* nothing anyone else can act on; the state moves to **Framing**.

**11. The student reads the scenario.** **The scenario** screen holds the **Scenario brief** and the
**Evidence Room**. Tassl records which documents were opened and for how long, and draws no conclusion
from it. The **AI assistant** panel is visible but locked.

**12. The student locks the frame.** They fill **Your frame** and press **Lock the frame**, confirming
in the dialog **Lock the frame permanently?**. *What changes:* the state chip becomes **Working**, the
**Working clock** starts, and the assistant unlocks. The instructor's table tracks the state live.

**13. The student works with the assistant.** They type into **Your request** and press **Ask the
assistant**. Claims arrive as cards; checks and escalations spend clock time; **Mark as used** in the
**Delegation Log** records that they leaned on a claim; **Declare outside-tool use** records anything
they used outside Tassl. *What changes:* the instructor's replay fills with trace events as they
happen, and can be read live.

**14. The student takes a stance on every claim.** One of **Accept**, **Verify**, **Challenge**,
**Reject** or **Escalate** on each card. A stance can be changed while the run is open, and both are
kept.

**15. The student files the decision.** They complete **Your decision brief** and press **Lock the
decision**, reading back **What will be filed** before pressing **File it**. *What changes:* the
brief, the frame, the log, every stance and every check are frozen. The state becomes **Decision
locked**. If the working clock runs out first, the run locks itself with whatever is written.

**16. The Turn arrives.** The wait is the scenario package's own, ninety seconds on **Meridian Roast
(fixture)**, and then the run reopens at **The Turn** for a twelve-minute window. The student reads
**What arrived** and **What this puts in front of you**, takes a stance on any claim
the window raises, and files **Hold**, **Revise** or **Reverse** with a reason and a confidence. If
the window closes with nothing filed, the decision already on record stands.

**17. The student answers the defense.** **The defense** asks six to nine questions drawn from this
run's own trace. There is no assistant, no Evidence Room and no clock. An answer with no source,
number or reason earns one **Follow-up**. **Finish the defense** closes it.

**18. The run is scored.** Tassl plots the four graphs and drafts a band on each of the seven
dimensions. The student waits on **Run status**, which updates itself. *What changes:* the student is
notified **Your run has been scored**; every reviewer of the section is notified **A run is ready to
review**; and the run appears in the instructor's **Review** queue. The
student's debrief opens with every band chipped **Draft** and the points labeled **Provisional
points, draft**.

**19. The instructor reads the replay and decides the seven bands.** From **Review** they open the
replay and work through **Overview**, **Bands**, **Trace**, **Package** and **Actions**. On each
dimension they press **Confirm the draft: {band}**, **Record {band} instead**, or **Record this
dimension as Unassessed**, optionally leaving a **Note for the student (optional)**.
**Confirm the remaining drafts** finishes the undecided ones in one step. *What changes:* the moment the
seventh decision lands, the run becomes **Confirmed**, the first course export version is written,
the run leaves the review queue, and the student is notified **Your bands are confirmed**.

This is the screen that decision is made on. The five views run across the top, the counter beside
them reads **1 of 7 decided**, and the seven dimensions are stacked down the page. Each one carries
the reading Tassl drafted, then the four bands and **Unassessed** to choose from — headed **Band for
Framing** on the first dimension, **Band for Delegation** on the next, and so on — then a **Note for
the student (optional)**, and the one button that puts the choice on the record.

![The instructor's replay screen, part way through deciding the seven bands](screenshots/instructor/replay-bands-to-decide.png)

**20. The student's debrief and record open.** The **Run Debrief** now carries the chip **Confirmed**
and shows what the instructor decided, with any note, across twelve sections. The student answers the
closing **Two questions**, which moves the run to **Recorded**, and then opens their **Judgment
Record** — the four graphs, the confirmed bands and the scenario they were taken under, downloadable
as a file. *What changes:* the run's state chip reads **Recorded** on the instructor's tables.

**21. The points reach the course.** The instructor opens **Course exports** and downloads the
version, which carries the seven bands, the course's mapping, the run's weight and the points. They
type the result into their institution's own gradebook. Tassl holds no grade.

Three things can still happen afterwards, and all three belong to the instructors of the course: enter a
**Correction** when Tassl got a claim wrong (which can raise a band and never lowers one), **Void this
run** when it cannot be scored at all, or delete a run outright — but only on a **Walkthrough**
assignment, because a run that counts is voided instead, which keeps the record.

## What the AI assistant does — and does not do

The assistant lives in the **AI assistant** panel on **The scenario** screen, and opens again during
the Turn window. It is unlocked only after the frame is locked, and closes at the decision lock.

A student can ask it anything inside the scenario, in their own words, up to 2,000 characters. It
will read from the documents, work through the figures, take a question about the student's own
draft brief, and answer a request to audit itself. Asking costs no clock time at all, and every
request and reply is kept in the **Delegation Log**.

What it surfaces are **claims**. Anything consequential arrives as its own card quoting the statement
word for word, and every card carries the same stance control. The claims are written by the
scenario's author, not invented on the spot, and which claims come up is decided by the phrases in
the request — so the assistant's prose varies from run to run while the cards do not.

On the **Defective** variant of a scenario, one of those claims is wrong on purpose — in **Meridian
Roast (fixture)** it is a payback figure carried forward from a slide that a later memo had already
corrected. The assistant is never told which claim that is and never decides; it presents every claim
in the same voice. It will not say, hint at, or imply that any claim is sound, stale, safer or worse
than another, and it will not rank them. Nothing on any student screen says that a defect exists at
all.

It also refuses, silently, to step outside the room. It will not write the student's decision brief,
though it will answer any question about it. It will not mention scoring, bands, levels, rubrics or
grades. It will not state a number, date or name that is not already in a claim, in a document the
student has opened, or in the student's own words — a figure with no such source is marked on screen
with the note "This figure is not in a claim or in a document you have opened. That says where it came
from, not whether it is right." When part of a request asks for something that does not exist here,
it answers the part that does and writes nothing about the rest. If nothing is left to say, the panel
shows one sentence: "The assistant could not add commentary on this request."

Declaring outside-tool use never counts against anyone. Beside the assistant sits **Declare
outside-tool use**, where a student writes what they used elsewhere and what for. The panel says so in
its own words: "A declaration never lowers a band or a point. Tassl does not detect, infer, or
estimate outside use, and nothing it records is treated as misconduct." The declaration is recorded
next to the run and has no other effect.

This is what one claim looks like on the student's screen: the claim's own heading and chip, the
statement quoted in full, the five stances under **Your stance** laid out as one choice, and
**Check it** and **Escalate** beneath them.

![The student's run screen, showing one claim card with its five stances](screenshots/learner/work-claim-card.png)

## What Tassl never does

**There is no composite score, no rank and no percentile.** Not on any screen, not in any export, not
anywhere. A run produces seven bands; the course's own mapping turns them into points, and the mean
is taken only over the dimensions actually assessed. A dimension marked **Unassessed** is left out of
the division, never counted as nothing. The student's own screen says it plainly: "There is no total
score, no rank, and no percentile anywhere in Tassl."

**Nothing Tassl observes is treated as misconduct.** It does not detect, infer or estimate outside AI
use. Facts recorded about a run appear to the instructor under **Conditions recorded on this run**,
and the screen states that none of them is a finding about the student. A reviewer's mark on a
delegation that fell outside the scenario simply leaves that exchange out of one band read, and the
student is never told about it.

**Students do not see the answer key before their run is scored.** Warranted stances, evidence
status, failure families, the planted flag, verification results, the answer space and which variant
they drew are all withheld until scoring, and then shown in the debrief with the evidence they were
read from.

**Some things a student never sees at any point:** the defense question bank and its expected-answer
notes, the seed record the package was adapted from, the fact that a lock came in unusually fast, the
fact that an instructor's test control caused an assistant outage, and any part of another student's
run — which answers **Not found**, indistinguishable from a run that does not exist.

**The app is whole without a model provider.** With AI features switched off, every request is
answered by the built-in scripted assistant, which is deterministic and costs nothing. The claim
cards, the clock, the Turn, the defense and the scoring are identical; the only visible difference on
a student's screen is the header chip reading **Scripted assistant** instead of **Live model**. No run
text leaves Tassl in that mode.

## Where to go next

Every role starts in the same place. **Sign in to Tassl** asks for **Email address** and **Password**,
keeps **Keep me signed in** ticked, and offers **Forgot your password?** and **Create an account**
below. What you see after you sign in is decided by your one role and the roster rows you hold, and
nothing else. The signed-out screens are explained field by field in
[the learner manual](02-learner.md).

![The signed-out sign-in screen, which is the same for every role](screenshots/shared/sign-in.png)

Then go to the file for your role. Each one is complete on its own and assumes only this chapter.

| If you are a… | Read |
|---|---|
| Instructor | [the instructor manual](01-instructor.md) |
| Student | [the learner manual](02-learner.md) |
| Scenario Editor | [the scenario editor manual](04-scenario-author.md), and [the learner manual](02-learner.md) for taking a run |
| Platform Admin | [the platform admin manual](03-admin.md) |

For a guided practice run with the demo accounts, follow the step-by-step walkthroughs instead:

- [the student guide](../guides/learner-guide.md) — sixteen tasks, from signing in to closing a run.
- [the instructor guide](../guides/instructor-guide.md) — eleven tasks, from creating a course to
  exporting results.
- [the demo runbook](../guides/demo-runbook.md) — the timed path through a live demonstration.
- [the guides index](../guides/README.md) — who reads what, and the demo accounts.
