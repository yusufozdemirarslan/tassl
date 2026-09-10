# Tassl Instructor Guide

## Who this is for

You teach a course that uses Tassl and you hold the **Instructor** seat in your institution.
You create courses, sections and assignments, and you decide what one run is worth in your gradebook.
After a student finishes a Decision Run and Tassl scores it, you read the run back, confirm or change each of the seven draft bands, and enter the result in the gradebook of record; Tassl holds no grade.
You can also author a scenario package of your own from a case your institution is licensed to adapt, and confirm it element by element before an assignment can run on it.
You need no software-testing background: every step below names the control you press, in bold, and says what the screen shows next.
Students, teaching assistants and platform admins have other guides; this one covers what the Instructor seat sees and does.

## Getting started

**Signing in.** Open the app and go to `/sign-in`. The demo instructor account is **instructor@tassl.local**. Its password is the seed password: on a local build and in CI it is the `SEED_PASSWORD` value in `.env.test`, which is **Walkthrough-Pass-2026**; in production (https://tassl.vercel.app) it is the value of the Vercel production variable `SEED_PASSWORD`, also kept in `~/.config/tassl/seed-password.txt` on the builder machine. Type the address in **Email address**, the password in **Password**, leave **Keep me signed in** ticked, and click **Sign in**. Sign-in is limited to ten attempts a minute; after that the page says **Too many attempts** and how many seconds to wait.

**The first screen.** After sign-in you land on **Home**, headed by your institution's name (**Walkthrough University** in the demo) and the line **What needs your attention, and what is coming up.** Four panels follow:

- **Your runs** — the runs you take as a student. It appears only on a seat that is enrolled as a student somewhere; an instructor seat with no student role does not see it.
- **Review** — runs of your sections that have draft bands waiting for your decision, each with **Open the replay for** the student's name; when there are none it reads **Nothing waiting**. **Open the review queue** opens the Review page.
- **Packages** — package versions of your institution that are still being confirmed, or **Nothing to confirm**. **Open the shelf** opens the Packages page.
- **Courses** — your courses with their term and counts, each with **Open** and the course name. **Open all courses** opens the Courses page.

**Navigation map.** Every item an instructor sees, and what it opens:

- **Skip to main content** — the first link on every page; it jumps past the header and the rail.
- **Tassl** (header) — Home.
- **Home** (rail) — the four panels above.
- **Courses** (rail) — every course in the institution; a course opens with the views **Sections**, **Assignments**, **Policy** and **Mapping**. A section row has a **Roster** link; an assignment row opens the assignment page, whose **Runs** table has **Open the replay** for every run and which links to **Course exports**.
- **Review** (rail) — **Runs waiting for you**: every scored run of a section you review, newest first, each with **Open the replay for** the student. The replay has the views **Overview**, **Bands**, **Trace**, **Package** and **Actions**.
- **Packages** (rail) — the scenario packages of the institution and **New package from a seed case**; a package row opens its latest version, from which you reach the generation screen and the confirmation workspace.
- **Notifications** (the bell in the header) — what Tassl has told you, newest first.
- **Account** (the header button that carries your name) — **Settings**, with the sections **Profile**, **Security** and **Data**, then **Privacy**, **Terms** and **Sign out**.
- The institution name in the header becomes a **Switch institution** menu when you belong to more than one.

Two rail items never appear for an instructor seat: **Runs** belongs to student seats and **Admin** to platform admins.

## Tasks

### Task 1: Sign in and find your way around

*Goal:* Start signed out, sign in as the instructor seat, and open every screen the rail, the bell and the account menu lead to.

*Steps:*

1. Open **/sign-in** in your browser. → You see: **Sign in to Tassl** with the fields **Email address** and **Password**.
   ![Task 1 step 1](screenshots/instructor/task-01-step-01.png)
2. Type **instructor@tassl.local** in **Email address**. → You see: **instructor@tassl.local** in the field.
   ![Task 1 step 2](screenshots/instructor/task-01-step-02.png)
3. Type the seed password (see Getting started) in **Password**. → You see: **Keep me signed in** ticked under the fields.
   ![Task 1 step 3](screenshots/instructor/task-01-step-03.png)
4. Click **Sign in**. → You see: the heading **Home** with **Walkthrough University** above it.
   ![Task 1 step 4](screenshots/instructor/task-01-step-04.png)
5. Read the rail under **Tassl** on the left. → You see: **Home**, **Courses**, **Review** and **Packages**.
   ![Task 1 step 5](screenshots/instructor/task-01-step-05.png)
6. Read the panels on **Home**. → You see: **Review**, **Packages** and **Courses**.
   ![Task 1 step 6](screenshots/instructor/task-01-step-06.png)
7. Click **Courses** in the rail. → You see: the heading **Courses** and the row **Marketing Strategy Walkthrough**.
   ![Task 1 step 7](screenshots/instructor/task-01-step-07.png)
8. Click **Review** in the rail. → You see: the heading **Review**, **Runs waiting for you** and **Nothing waiting**.
   ![Task 1 step 8](screenshots/instructor/task-01-step-08.png)
9. Click **Packages** in the rail. → You see: the heading **Packages** and the row **Meridian Roast (fixture)**.
   ![Task 1 step 9](screenshots/instructor/task-01-step-09.png)
10. Click **Home** in the rail. → You see: **What needs your attention, and what is coming up.**
   ![Task 1 step 10](screenshots/instructor/task-01-step-10.png)
11. Click the **Notifications** bell in the header. → You see: the heading **Notifications** and **What Tassl has told you, newest first.**
   ![Task 1 step 11](screenshots/instructor/task-01-step-11.png)
12. Click the **Account** button in the header (your name is part of its label). → You see: the menu items **Settings**, **Privacy**, **Terms** and **Sign out**.
   ![Task 1 step 12](screenshots/instructor/task-01-step-12.png)

*If something goes wrong:*

- "That email address and password do not match an account." — the address or the password is wrong; the demo password is the seed password named in Getting started, and the account is instructor@tassl.local.
- "Too many attempts. Wait a minute and try again." — ten sign-in attempts a minute is the limit; wait the time it names and sign in again.
- "Confirm your email address before you sign in." — the account has not confirmed its address; click **Resend verification**, open the link in the email, then sign in.

### Task 2: Create a course

*Goal:* Create the course the rest of this guide builds on.

*Steps:*

1. Click **Courses** in the rail. → You see: the heading **Courses** and the button **New course**.
   ![Task 2 step 1](screenshots/instructor/task-02-step-01.png)
2. Click **New course**. → You see: the dialog **New course** with **Name it and give it a term. Policy, weight, and the band mapping are set on the course once it exists.**
   ![Task 2 step 2](screenshots/instructor/task-02-step-02.png)
3. Type **Guide course 2026** in **Course name**. → You see: **Guide course 2026** in the field.
   ![Task 2 step 3](screenshots/instructor/task-02-step-03.png)
4. Type **2026-fall** in **Term**. → You see: **2026-fall** in the field.
   ![Task 2 step 4](screenshots/instructor/task-02-step-04.png)
5. Click **Create course**. → You see: the message **Guide course 2026 is ready.** and the heading **Guide course 2026**.
   ![Task 2 step 5](screenshots/instructor/task-02-step-05.png)
6. Read the line under the heading **Guide course 2026**. → You see: **Term 2026-fall**.
   ![Task 2 step 6](screenshots/instructor/task-02-step-06.png)
7. Read the row of tabs under the heading. → You see: **Sections**, **Assignments**, **Policy** and **Mapping**.
   ![Task 2 step 7](screenshots/instructor/task-02-step-07.png)

*If something goes wrong:*

- "Give the course a name." or "Give the course a term." — both fields are required; a name is at most 200 characters and a term at most 100.
- "You do not have permission to do this." — only an instructor of the institution creates a course; a program lead or a student seat reads courses and cannot add one.

### Task 3: Add a section and its students

*Goal:* Do this after Task 2: add a section to Guide course 2026, put both demo students on its roster, and add yourself as its instructor so that its runs reach your Review page.

*Steps:*

1. Click **Courses** in the rail. → You see: the row **Guide course 2026**.
   ![Task 3 step 1](screenshots/instructor/task-03-step-01.png)
2. Click **Guide course 2026** on its row. → You see: **Sections** and **No sections yet**.
   ![Task 3 step 2](screenshots/instructor/task-03-step-02.png)
3. Click **New section**. → You see: the dialog **New section** with **Sections divide one course into rosters. An assignment is configured on a section.**
   ![Task 3 step 3](screenshots/instructor/task-03-step-03.png)
4. Type **Guide section** in **Section name**. → You see: **Guide section** in the field.
   ![Task 3 step 4](screenshots/instructor/task-03-step-04.png)
5. Click **Add section**. → You see: the message **Section Guide section added.** and the row **Guide section**.
   ![Task 3 step 5](screenshots/instructor/task-03-step-05.png)
6. Click **Roster** on the **Guide section** row. → You see: **Section roster** and **Nobody is in this section yet**.
   ![Task 3 step 6](screenshots/instructor/task-03-step-06.png)
7. Type **student2@tassl.local** in **Email address** under **Add member**. → You see: **Role in this section** reading **Student**.
   ![Task 3 step 7](screenshots/instructor/task-03-step-07.png)
8. Click **Add to section**. → You see: **student2@tassl.local is now in this section.** and the row **Student Two** with the role **Student**.
   ![Task 3 step 8](screenshots/instructor/task-03-step-08.png)
9. Type **student1@tassl.local** in **Email address**. → You see: **student1@tassl.local** in the field.
   ![Task 3 step 9](screenshots/instructor/task-03-step-09.png)
10. Click **Add to section**. → You see: **student1@tassl.local is now in this section.** and the row **Student One**.
   ![Task 3 step 10](screenshots/instructor/task-03-step-10.png)
11. Type **instructor@tassl.local** in **Email address**. → You see: **instructor@tassl.local** in the field.
   ![Task 3 step 11](screenshots/instructor/task-03-step-11.png)
12. Choose **Instructor** in **Role in this section**. → You see: **Instructor** on the role control.
   ![Task 3 step 12](screenshots/instructor/task-03-step-12.png)
13. Click **Add to section**. → You see: **instructor@tassl.local is now in this section.** and the row **Instructor Seat** with the role **Instructor**.
   ![Task 3 step 13](screenshots/instructor/task-03-step-13.png)
14. Click **Back to the course**. → You see: the heading **Guide course 2026** and **3** in the **Members** column of the **Guide section** row.
   ![Task 3 step 14](screenshots/instructor/task-03-step-14.png)

*If something goes wrong:*

- "That address does not belong to this institution yet." — the person has no account in the institution; click **Invite to institution**, check the address, click **Send invitation**, and add them to the section once they accept (an invitation lasts seven days and can be accepted once).
- "Enter a valid email address." — the address is malformed; type the address the person signs in with.
- "This person has runs in the section, so they cannot be removed." — **Remove** is refused once a person has a run here; the roster keeps them so their runs keep their place.

### Task 4: Set the course policy and the grade mapping

*Goal:* Do this after Task 2: set the outside-AI policy, the default run weight and the taught concepts of Guide course 2026, then change what a confirmed band is worth.

*Steps:*

1. Click **Courses** in the rail. → You see: the row **Guide course 2026**.
   ![Task 4 step 1](screenshots/instructor/task-04-step-01.png)
2. Click **Guide course 2026**. → You see: the heading **Guide course 2026** and the tabs **Sections**, **Assignments**, **Policy** and **Mapping**.
   ![Task 4 step 2](screenshots/instructor/task-04-step-02.png)
3. Click the **Policy** tab. → You see: **Policy and weight**, the legend **Outside-AI policy** and **Declared** selected.
   ![Task 4 step 3](screenshots/instructor/task-04-step-03.png)
4. Choose **In-Environment Only**. → You see: **The course asks students to work only with the assistant inside Tassl. A declaration of outside use is still recorded and shown to you, with no scoring effect; what follows is your call.**
   ![Task 4 step 4](screenshots/instructor/task-04-step-04.png)
5. Type **3** in **Default run weight**. → You see: **3** in the field.
   ![Task 4 step 5](screenshots/instructor/task-04-step-05.png)
6. Type **payback period** in **Taught concepts**. → You see: **payback period** in the field.
   ![Task 4 step 6](screenshots/instructor/task-04-step-06.png)
7. Click **Save policy**. → You see: **Policy saved.**
   ![Task 4 step 7](screenshots/instructor/task-04-step-07.png)
8. Click the **Mapping** tab. → You see: **Band-to-points mapping** and the fields **Novice**, **Developing**, **Proficient** and **Professional**.
   ![Task 4 step 8](screenshots/instructor/task-04-step-08.png)
9. Type **5** in **Professional**. → You see: **5** in the field.
   ![Task 4 step 9](screenshots/instructor/task-04-step-09.png)
10. Click **Preview changes**. → You see: **What would change** and **No run in this course is confirmed yet, so nothing is re-exported. Applying sets the mapping for the runs that follow.**
   ![Task 4 step 10](screenshots/instructor/task-04-step-10.png)
11. Tick **I understand every confirmed run will be re-exported.** → You see: the box ticked and the button **Apply the new mapping**.
   ![Task 4 step 11](screenshots/instructor/task-04-step-11.png)
12. Click **Apply the new mapping**. → You see: **The mapping is saved. 0 runs were re-exported.**
   ![Task 4 step 12](screenshots/instructor/task-04-step-12.png)

*If something goes wrong:*

- "Tick the box above before applying: every confirmed run in this course gets a new export version." — the acknowledgement is required; tick it and click **Apply the new mapping** again.
- "These four numbers have changed since the preview. Preview again before applying." — you edited a field after previewing; click **Preview changes** again, then apply.
- "Points must be above zero." or "A weight cannot be negative." — every band value is a positive number and the weight is zero or more.

### Task 5: Read a scenario package

*Goal:* Open the seeded Meridian Roast package and read what a confirmed version holds, down to one claim.

*Steps:*

1. Click **Packages** in the rail. → You see: the row **Meridian Roast (fixture)** with **Confirmed** and **Uncalibrated**.
   ![Task 5 step 1](screenshots/instructor/task-05-step-01.png)
2. Click **Meridian Roast (fixture)** on its row. → You see: the heading **Meridian Roast (fixture)** and **This version**.
   ![Task 5 step 2](screenshots/instructor/task-05-step-02.png)
3. Read **This version**. → You see: **Status** with **Confirmed**, **Working clock** with **25 min** and **Turn delay** with **1 min 30 s**.
   ![Task 5 step 3](screenshots/instructor/task-05-step-03.png)
4. Read **Confirmation record**. → You see: **Decisions by element type** with the columns **Element type**, **Decisions**, **By** and **Latest decision**.
   ![Task 5 step 4](screenshots/instructor/task-05-step-04.png)
5. Read **Authoring record**. → You see: **Generating model**, **The seed case** and **Re-skin log**.
   ![Task 5 step 5](screenshots/instructor/task-05-step-05.png)
6. Read **Authoring measures**. → You see: **Seed to confirmed**, **Edit rate**, **Rejected share**, **Generation passes** and **Review time per element**.
   ![Task 5 step 6](screenshots/instructor/task-05-step-06.png)
7. Read **Claims**. → You see: **Claims and their per-variant states** with the columns **Defective variant** and **Sound variant**.
   ![Task 5 step 7](screenshots/instructor/task-05-step-07.png)
8. Click **C3** in the **Claims** table. → You see: **Claim C3**, **Where it comes from** and **What it deserved, and why**.
   ![Task 5 step 8](screenshots/instructor/task-05-step-08.png)
9. Click **All claims**. → You see: **Claims and their per-variant states**.
   ![Task 5 step 9](screenshots/instructor/task-05-step-09.png)
10. Click **Export package JSON**. → You see: the version page unchanged, with the link **Export package JSON** still on it; your browser saves the file **tassl-package-meridian-roast.json**.
   ![Task 5 step 10](screenshots/instructor/task-05-step-10.png)

*If something goes wrong:*

- "Packages are not open to your seat" — only an instructor or a scenario author of the institution reads packages; ask whoever manages the institution's roster to change your seat.
- "The claims are not open to your seat" — a program lead reads the measures only; an instructor, a scenario author or a teaching assistant of the institution opens the claims.
- "Not found" — the address names a version of another institution, or a package id that does not exist; go back to **Packages** and open the row.

### Task 6: Create an assignment

*Goal:* Do this after Tasks 3 and 4: point an assignment on Guide section at the confirmed Meridian Roast version.

*Steps:*

1. Click **Courses** in the rail. → You see: the row **Guide course 2026**.
   ![Task 6 step 1](screenshots/instructor/task-06-step-01.png)
2. Click **Guide course 2026**. → You see: the heading **Guide course 2026**.
   ![Task 6 step 2](screenshots/instructor/task-06-step-02.png)
3. Click the **Assignments** tab. → You see: **Assignments** and **No assignments yet**.
   ![Task 6 step 3](screenshots/instructor/task-06-step-03.png)
4. Click **New assignment**. → You see: the dialog **New assignment** and **This assignment goes to Guide section, the only section of this course.**
   ![Task 6 step 4](screenshots/instructor/task-06-step-04.png)
5. Type **Guide run** in **Assignment name**. → You see: **Guide run** in the field.
   ![Task 6 step 5](screenshots/instructor/task-06-step-05.png)
6. Choose **Meridian Roast (fixture) · version 1** in **Scenario package version**. → You see: **Meridian Roast (fixture) · version 1** with the chip **Uncalibrated**.
   ![Task 6 step 6](screenshots/instructor/task-06-step-06.png)
7. Choose **Defective** under **Variant**. → You see: **The assistant states one consequential claim that does not hold up.**
   ![Task 6 step 7](screenshots/instructor/task-06-step-07.png)
8. Type **600** in **Working clock (seconds)**. → You see: **The package sets 1500 seconds. Leave this empty to follow it.**
   ![Task 6 step 8](screenshots/instructor/task-06-step-08.png)
9. Type **2** in **Weight**. → You see: **The course sets 3. Leave this empty to follow it.**
   ![Task 6 step 9](screenshots/instructor/task-06-step-09.png)
10. Turn on the **Walkthrough** switch. → You see: **A practice assignment. A run on it can be deleted; a run that counts is voided instead.** and, at the foot of the dialog, the button **Create assignment**.
   ![Task 6 step 10](screenshots/instructor/task-06-step-10.png)
11. Click **Create assignment**. → You see: **Guide run is ready.**, the heading **Guide run** and the chip **Walkthrough**.
   ![Task 6 step 11](screenshots/instructor/task-06-step-11.png)
12. Read **Configuration**. → You see: **What every run on this assignment is taken under.** and the button **Save configuration**.
   ![Task 6 step 12](screenshots/instructor/task-06-step-12.png)
13. Read **Runs**. → You see: **No runs yet** and **Once a student starts this assignment, their run appears here with its state and its replay.**
   ![Task 6 step 13](screenshots/instructor/task-06-step-13.png)

*If something goes wrong:*

- "An assignment belongs to a section. Add a section to this course first." — **New assignment** stays greyed until the course has a section; do Task 3 first.
- "An assignment runs on a confirmed scenario package version. Confirm one, then configure the assignment." — no version in the institution is confirmed; confirm one (Task 11) or use the seeded Meridian Roast version.
- "Enter whole seconds, at least 60, or leave it empty." — the working clock is whole seconds of at least 60; leave the field empty to use the package's own clock.

### Task 7: Follow your students’ runs

*Goal:* Do this after Task 6, once a student has finished a run on Guide run and Tassl has scored it (the automated test drives Student Two's run to that point).

*Steps:*

1. Click **Courses** in the rail. → You see: the row **Guide course 2026**.
   ![Task 7 step 1](screenshots/instructor/task-07-step-01.png)
2. Click **Guide course 2026**. → You see: the heading **Guide course 2026**.
   ![Task 7 step 2](screenshots/instructor/task-07-step-02.png)
3. Click the **Assignments** tab. → You see: the row **Guide run** with **Decision run** and **Open now**.
   ![Task 7 step 3](screenshots/instructor/task-07-step-03.png)
4. Click **Guide run** on its row. → You see: **Runs** with the row **Student Two**, the state **Scored**, **0 of 7** and **None yet**.
   ![Task 7 step 4](screenshots/instructor/task-07-step-04.png)
5. Click **Review** in the rail. → You see: **Runs waiting for you** with **Student Two**, **Scored**, **0 of 7** and **Open the replay for Student Two**.
   ![Task 7 step 5](screenshots/instructor/task-07-step-05.png)
6. Read the note under the **Runs waiting for you** table. → You see: **Which variant a student drew is on the replay rather than in this list, so this screen can be shown to a room.**
   ![Task 7 step 6](screenshots/instructor/task-07-step-06.png)
7. Click **Home** in the rail. → You see: the **Review** panel with **Student Two**, **0 of 7 decided** and **Open the replay for Student Two**.
   ![Task 7 step 7](screenshots/instructor/task-07-step-07.png)

*If something goes wrong:*

- "Nothing waiting" — no run of a section you review is at **Scored**; a run reaches the queue only after the student finishes the defense and scoring completes, and leaves it once you confirm all seven bands.
- "Your instructor is reviewing this run." on the student's list, **Under review** in the assignment's table — Tassl could not place the bands; open the replay and use **Band this run by hand** (see Troubleshooting).
- "Not found" on a replay — you hold no row on the run's section roster; add yourself as **Instructor** on the roster (Task 3, steps 11 to 13).

### Task 8: Review a scored run

*Goal:* Do this after Task 7; it needs Student Two's scored run on Guide run (the automated test creates it), and it ends with all seven bands on the record and course export version 1 written.

*Steps:*

1. Click **Review** in the rail. → You see: **Open the replay for Student Two**.
   ![Task 8 step 1](screenshots/instructor/task-08-step-01.png)
2. Click **Open the replay for Student Two**. → You see: the heading **Student Two**, **Attempt 1 · Defective variant** and the views **Overview**, **Bands**, **Trace**, **Package** and **Actions**.
   ![Task 8 step 2](screenshots/instructor/task-08-step-02.png)
3. Read **The four graphs**. → You see: **Confidence line**, **Clock timeline**, **Stance matrix** and **Frame beside decision**.
   ![Task 8 step 3](screenshots/instructor/task-08-step-03.png)
4. Click the first **Show data table**. → You see: that button now reads **Show graph**.
   ![Task 8 step 4](screenshots/instructor/task-08-step-04.png)
5. Read **Defense transcript**. → You see: **Question 1** and **Expected-answer notes**.
   ![Task 8 step 5](screenshots/instructor/task-08-step-05.png)
6. Read **Delegation log**. → You see: **Every request the student made of the assistant, and what came back.**
   ![Task 8 step 6](screenshots/instructor/task-08-step-06.png)
7. Read **Readiness Check**. → You see: **The concept map the Readiness Check closed with.**
   ![Task 8 step 7](screenshots/instructor/task-08-step-07.png)
8. Click **Trace**. → You see: **The run’s trace** with the columns **No.**, **Clock left**, **Event**, **What it says** and **Record**.
   ![Task 8 step 8](screenshots/instructor/task-08-step-08.png)
9. Click **Bands**. → You see: **The seven bands** and **0 of 7 decided**.
   ![Task 8 step 9](screenshots/instructor/task-08-step-09.png)
10. On **Framing**, click the button that begins **Confirm the draft**. → You see: **The decision is on the record.** and **1 of 7 decided**.
   ![Task 8 step 10](screenshots/instructor/task-08-step-10.png)
11. On **Verification**, choose **Professional** (or **Proficient** when the draft is already Professional). → You see: the button **Record Professional instead** (or **Record Proficient instead**).
   ![Task 8 step 11](screenshots/instructor/task-08-step-11.png)
12. Type **Guide note. Check the memo date.** in **Note for the student (optional)** on **Verification**. → You see: **Guide note. Check the memo date.** in the field.
   ![Task 8 step 12](screenshots/instructor/task-08-step-12.png)
13. Click **Record Professional instead** (or **Record Proficient instead**). → You see: **2 of 7 decided** and **Note to the student: Guide note. Check the memo date.**
   ![Task 8 step 13](screenshots/instructor/task-08-step-13.png)
14. Click **Confirm the remaining drafts**. → You see: the dialog **Confirm the remaining drafts?** and **Confirming these writes course export version 1.**
   ![Task 8 step 14](screenshots/instructor/task-08-step-14.png)
15. Click **Put the remaining drafts on the record**. → You see: **7 of 7 decided** and the chip **Confirmed**.
   ![Task 8 step 15](screenshots/instructor/task-08-step-15.png)
16. Read **Points under this course’s mapping**. → You see: **From the seven bands on the record**, **Total over the assessed dimensions (7)** and **Enter the bands, the mapping and the points in the gradebook of record. Tassl holds no grade.**
   ![Task 8 step 16](screenshots/instructor/task-08-step-16.png)
17. Read **Course exports** on the same view. → You see: **The bands were confirmed** and the link **Download version 1**.
   ![Task 8 step 17](screenshots/instructor/task-08-step-17.png)

*If something goes wrong:*

- "No draft bands yet" with "The seven drafts are written after the defense is filed and the run has been read." — the run is not scored yet; wait for the student to finish the defense, then reload.
- "Choose a band, or mark the dimension not assessed." — you pressed the decision button with nothing selected; pick a band or **Unassessed** and press again.
- "The instructor has decided this dimension." — a teaching-assistant seat cannot change a band an instructor decided; the instructor for the section can.

### Task 9: Correct a claim, arm the outage control, and void a run

*Goal:* Do this after Task 8; it also needs a second scored run on Guide run, taken by Student One (the automated test creates it), which this task voids and re-offers.

*Steps:*

1. Click **Courses** in the rail. → You see: the row **Guide course 2026**.
   ![Task 9 step 1](screenshots/instructor/task-09-step-01.png)
2. Click **Guide course 2026**. → You see: the heading **Guide course 2026**.
   ![Task 9 step 2](screenshots/instructor/task-09-step-02.png)
3. Click the **Assignments** tab. → You see: the row **Guide run**.
   ![Task 9 step 3](screenshots/instructor/task-09-step-03.png)
4. Click **Guide run**. → You see: the heading **Guide run** and the row **Student Two** in **Runs** with the link **Open the replay**.
   ![Task 9 step 4](screenshots/instructor/task-09-step-04.png)
5. Click **Open the replay** on the **Student Two** row. → You see: the heading **Student Two**.
   ![Task 9 step 5](screenshots/instructor/task-09-step-05.png)
6. Click **Actions**. → You see: **Corrections** and **No correction has been entered on this run.**
   ![Task 9 step 6](screenshots/instructor/task-09-step-06.png)
7. Click **Enter a correction on C3…**. → You see: the dialog **Enter a correction on claim C3?** and **What went wrong?** with **The claim carried a defect nobody placed** selected.
   ![Task 9 step 7](screenshots/instructor/task-09-step-07.png)
8. Tick **Credit the student’s challenge as correct**. → You see: the box ticked.
   ![Task 9 step 8](screenshots/instructor/task-09-step-08.png)
9. Click **Enter the correction**. → You see: **What the correction moved**, **A correction can raise a band and never lowers one.** and **Export version 2 was written.**
   ![Task 9 step 9](screenshots/instructor/task-09-step-09.png)
10. Click **Close**. → You see: **Corrections on this run** listing **C3** and **The student’s challenge was credited.**
   ![Task 9 step 10](screenshots/instructor/task-09-step-10.png)
11. Read **Test controls**. → You see: **Arm one assistant outage** and **It exists for step 7 of the walkthrough, where the run has to meet an outage the student did not ask for and carry on without the assistant.**
   ![Task 9 step 11](screenshots/instructor/task-09-step-11.png)
12. Read the button **Arm the outage** and the line under it. → You see: **This run is not in a state that can take an outage. One can be armed while the student is working, answering the Turn, or paused.**
   ![Task 9 step 12](screenshots/instructor/task-09-step-12.png)
13. Click **Review** in the rail. → You see: **Open the replay for Student One**.
   ![Task 9 step 13](screenshots/instructor/task-09-step-13.png)
14. Click **Open the replay for Student One**. → You see: the heading **Student One**.
   ![Task 9 step 14](screenshots/instructor/task-09-step-14.png)
15. Click **Actions**. → You see: **Void this run** and **A voided run carries no partial result, and no export written afterwards names it. Offer another run in its place when the student should still take one.**
   ![Task 9 step 15](screenshots/instructor/task-09-step-15.png)
16. Click **Void this run…**. → You see: the dialog **Void this run?** and **Why is the run being voided?**
   ![Task 9 step 16](screenshots/instructor/task-09-step-16.png)
17. Choose **It was a walkthrough run**. → You see: **It was a walkthrough run** selected.
   ![Task 9 step 17](screenshots/instructor/task-09-step-17.png)
18. Tick **Offer the student another run**. → You see: **Variant for the new run** reading **The other variant**.
   ![Task 9 step 18](screenshots/instructor/task-09-step-18.png)
19. Click **Void the run**. → You see: **The run is voided and another has been offered.** and **This run is voided. It carries no partial result, and no export written afterwards names it.**
   ![Task 9 step 19](screenshots/instructor/task-09-step-19.png)

*If something goes wrong:*

- "A correction has already been entered on this claim for this run." — one correction per claim per run; the claim reads **This claim already carries a correction.** and needs nothing more.
- "This run has no assistant running, so there is nothing to fail. Arm it while the student is working or answering the Turn." — the outage can only be armed while the student's run is at **Working**, **Turn open** or **Paused**; on a scored run the button stays greyed.
- "Test controls are switched off in this environment." — the deployment runs without `FEATURE_TEST_CONTROLS`; the panel is absent and nothing can be armed.

### Task 10: Export results to the gradebook

*Goal:* Do this after Task 9: download the course export that carries the bands, the mapping and the points for the gradebook of record; the student's own copy is the Judgment Record they download from their run page, which carries no points.

*Steps:*

1. Click **Courses** in the rail. → You see: the row **Guide course 2026**.
   ![Task 10 step 1](screenshots/instructor/task-10-step-01.png)
2. Click **Guide course 2026**. → You see: the heading **Guide course 2026**.
   ![Task 10 step 2](screenshots/instructor/task-10-step-02.png)
3. Click the **Assignments** tab. → You see: the row **Guide run**.
   ![Task 10 step 3](screenshots/instructor/task-10-step-03.png)
4. Click **Guide run**. → You see: the heading **Guide run** and the link **Course exports**.
   ![Task 10 step 4](screenshots/instructor/task-10-step-04.png)
5. Click **Course exports**. → You see: the heading **Course exports**, **Every version written** and **Enter bands, mapping, and points in the gradebook of record; Tassl holds no grade.**
   ![Task 10 step 5](screenshots/instructor/task-10-step-05.png)
6. Read the **Every version written** table. → You see: **Student Two** under **Student**, **A correction was entered** on version **2** and **The bands were confirmed** on version **1**.
   ![Task 10 step 6](screenshots/instructor/task-10-step-06.png)
7. Click **Download version 2**. → You see: the **Every version written** table unchanged; your browser saves a file whose name begins **tassl-course-export-** and ends **-v2.json**.
   ![Task 10 step 7](screenshots/instructor/task-10-step-07.png)
8. Click **Back to the assignment**. → You see: the heading **Guide run**.
   ![Task 10 step 8](screenshots/instructor/task-10-step-08.png)

*If something goes wrong:*

- "No export yet" with "The first export for a run is written when all seven of its bands carry a decision. Every correction after that writes another." — no run on this assignment is confirmed; finish Task 8 first.
- "Replay needs a place in the section" instead of **Open the replay** — you are the course's instructor without a row on the section roster; add yourself as **Instructor** on the roster.
- "That export version does not exist for this run." — the run was voided after this version was written, or the version number is wrong; a voided run keeps no export.

### Task 11: Author a new scenario package from a seed case

*Goal:* Build a package of your own from a licensed case on the scripted assistant, decide every element in the confirmation workspace, and freeze version 1.

*Steps:*

1. Click **Packages** in the rail. → You see: the link **New package from a seed case**.
   ![Task 11 step 1](screenshots/instructor/task-11-step-01.png)
2. Click **New package from a seed case**. → You see: the heading **New package from a seed case** with the panels **The package** and **The seed case**.
   ![Task 11 step 2](screenshots/instructor/task-11-step-02.png)
3. Type **Guide package 2026** in **Title**. → You see: **Family key** reading **guide-package-2026**.
   ![Task 11 step 3](screenshots/instructor/task-11-step-03.png)
4. Type **payback, retention, acquisition, pricing** in **Concepts**. → You see: the button **Add** beside the field.
   ![Task 11 step 4](screenshots/instructor/task-11-step-04.png)
5. Click **Add**. → You see: **4 added. Four is the minimum.**
   ![Task 11 step 5](screenshots/instructor/task-11-step-05.png)
6. Type **Guide seed case** in **Case title**. → You see: **Guide seed case** in the field.
   ![Task 11 step 6](screenshots/instructor/task-11-step-06.png)
7. Type **Guide Press** in **Publisher**. → You see: **Guide Press** in the field.
   ![Task 11 step 7](screenshots/instructor/task-11-step-07.png)
8. Type **Guide license terms permit adaptation.** in **License terms**. → You see: **Guide license terms permit adaptation.** in the field.
   ![Task 11 step 8](screenshots/instructor/task-11-step-08.png)
9. Tick **The license permits adaptation**. → You see: the box ticked and **Tassl records this confirmation against your name and keeps it in the seed record. It will not build a package from a case without it.**
   ![Task 11 step 9](screenshots/instructor/task-11-step-09.png)
10. Type **Guide seed case text for the walkthrough.** five times in **Seed case text**. → You see: the counter under the field ending **of 200,000 characters**.
   ![Task 11 step 10](screenshots/instructor/task-11-step-10.png)
11. Click **Create and generate**. → You see: the heading **Guide package 2026** and **The seven steps**.
   ![Task 11 step 11](screenshots/instructor/task-11-step-11.png)
12. Wait for every row of **The seven steps** to finish. → You see: **Every package rule is met**, **Done** on all seven steps and the link **Open confirmation workspace**.
   ![Task 11 step 12](screenshots/instructor/task-11-step-12.png)
13. Click **Open confirmation workspace**. → You see: **Confirming version 1**, the list **Elements** and the heading **Brief**.
   ![Task 11 step 13](screenshots/instructor/task-11-step-13.png)
14. Open **Documents** in **Elements** and click **D1**. → You see: the heading **Document · D1**.
   ![Task 11 step 14](screenshots/instructor/task-11-step-14.png)
15. Click **Reject**. → You see: under the buttons, **Say what is wrong with it. The note is kept with the decision, and the element stays in the version until it is re-authored.** and the field **Why this element is rejected**.
   ![Task 11 step 15](screenshots/instructor/task-11-step-15.png)
16. Type **Guide rejection. The dateline reads as an internal memo.** in **Why this element is rejected**. → You see: the sentence in the field.
   ![Task 11 step 16](screenshots/instructor/task-11-step-16.png)
17. Click **Reject element**. → You see: **D1 rejected.** and **1 rejected** in the progress line.
   ![Task 11 step 17](screenshots/instructor/task-11-step-17.png)
18. Click **D1** in **Elements** again. → You see: **Rejected, and waiting to be re-authored**.
   ![Task 11 step 18](screenshots/instructor/task-11-step-18.png)
19. Click **Rewrite**. → You see: under the buttons, **A new draft is written for every document in this version, this one included.** and the button **Rewrite every document in this version**.
   ![Task 11 step 19](screenshots/instructor/task-11-step-19.png)
20. Click **Rewrite every document in this version**. → You see: **A new draft of D1 was asked for.** and **Writing a new draft**.
   ![Task 11 step 20](screenshots/instructor/task-11-step-20.png)
21. Wait for **Writing a new draft** to finish. → You see: **The new draft of D1 is on the screen.**
   ![Task 11 step 21](screenshots/instructor/task-11-step-21.png)
22. Click **D2** in **Elements**. → You see: the heading **Document · D2**.
   ![Task 11 step 22](screenshots/instructor/task-11-step-22.png)
23. Type **Guide document title** in **Title**. → You see: **Guide document title** in the field.
   ![Task 11 step 23](screenshots/instructor/task-11-step-23.png)
24. Click **Save edits**. → You see: **D2 saved. The edit is recorded as its decision.** and the chip **Edited**.
   ![Task 11 step 24](screenshots/instructor/task-11-step-24.png)
25. Click **Next undecided element**. → You see: the chip **Undecided** on the open element.
   ![Task 11 step 25](screenshots/instructor/task-11-step-25.png)
26. Click **Confirm** on each element in turn until **Every element has a decision.** appears. → You see: **Every element has a decision.**
   ![Task 11 step 26](screenshots/instructor/task-11-step-26.png)
27. Tick **Teaching note checked against the answer space and claims**. → You see: the box ticked.
   ![Task 11 step 27](screenshots/instructor/task-11-step-27.png)
28. Click **Confirm version**. → You see: the dialog **Confirm version 1?** with **All met** and **Checked against the answer space and the claims, and kept with the confirmation**.
   ![Task 11 step 28](screenshots/instructor/task-11-step-28.png)
29. Click **Confirm and freeze**. → You see: **Version 1 is confirmed and frozen.** and the link **Back to version 1**.
   ![Task 11 step 29](screenshots/instructor/task-11-step-29.png)
30. Click **Back to version 1**. → You see: **Status** with **Confirmed** and the line beginning **Version 1 was confirmed on**.
   ![Task 11 step 30](screenshots/instructor/task-11-step-30.png)

*If something goes wrong:*

- "This institution already has a package with that family key. Change it and create again." — a package with the key **guide-package-2026** already exists; type a different **Family key** (lowercase letters, digits and hyphens, 3 to 60 characters) and click **Create and generate** again.
- "Generation has not run on this version" — the package was created but the seven steps did not start; click **Start generation** on that screen and wait for **Every package rule is met**.
- "Every element needs a decision before the version can be confirmed." or "Confirm you have read the teaching note first." — **Waiting on a decision** names the elements still undecided (a rejected element counts as undecided until it is rewritten or saved); decide each one, tick the teaching-note box, and confirm again.

### Task 12: Manage notifications, your account, and sign out

*Goal:* Do this after Task 8 so that at least one notification is waiting: read and clear your notifications, check the three account settings sections, and sign out.

*Steps:*

1. Click the **Notifications** bell in the header. → You see: the heading **Notifications** and the row **A run is ready to review**.
   ![Task 12 step 1](screenshots/instructor/task-12-step-01.png)
2. Click **Mark all read**. → You see: **Everything is marked read.**
   ![Task 12 step 2](screenshots/instructor/task-12-step-02.png)
3. Click the **Account** button in the header. → You see: the menu items **Settings**, **Privacy**, **Terms** and **Sign out**.
   ![Task 12 step 3](screenshots/instructor/task-12-step-03.png)
4. Click **Settings**. → You see: the heading **Account settings**, the panel **Profile** and **Your name** reading **Instructor Seat**.
   ![Task 12 step 4](screenshots/instructor/task-12-step-04.png)
5. Click **Save changes**. → You see: **Your name is saved.**
   ![Task 12 step 5](screenshots/instructor/task-12-step-05.png)
6. Click **Security**. → You see: the panels **Password** and **Signed-in devices** with the badge **This device**.
   ![Task 12 step 6](screenshots/instructor/task-12-step-06.png)
7. Click **Data**. → You see: the panels **Download my data** and **Delete account**.
   ![Task 12 step 7](screenshots/instructor/task-12-step-07.png)
8. Click **Delete my account**. → You see: the dialog **Delete your account?** and the field **Type instructor@tassl.local to confirm**.
   ![Task 12 step 8](screenshots/instructor/task-12-step-08.png)
9. Click **Keep my account**. → You see: the panel **Delete account** with its button **Delete my account** and no dialog.
   ![Task 12 step 9](screenshots/instructor/task-12-step-09.png)
10. Click the **Account** button in the header. → You see: the menu items **Settings**, **Privacy**, **Terms** and **Sign out**.
   ![Task 12 step 10](screenshots/instructor/task-12-step-10.png)
11. Click **Sign out**. → You see: **Sign in to Tassl**.
   ![Task 12 step 11](screenshots/instructor/task-12-step-11.png)

*If something goes wrong:*

- "Nothing yet" on Notifications — nothing has been written to you; Tassl writes here when a run in your section is scored, a package finishes generating, or a course export is ready.
- "You can download your data twice an hour. Try again shortly." — **Download my data** is limited to two downloads an hour; wait and try again.
- "Type the email address of this account to confirm." — the deletion dialog only enables **Delete my account** once the typed address equals the account's own; the demo instructor account is not deleted in this guide, so click **Keep my account**.

## What the AI does and does not do

**What the assistant is for in a run.** The assistant is the AI in the room. It stays locked until the student locks their frame, so the first position is the student's own; from then until the decision is filed, and again inside the twelve-minute Turn window, the student can ask it anything in the scenario. Every consequential thing it states arrives as a claim card, quoted verbatim, that the student takes a stance on: **Accept**, **Verify**, **Challenge**, **Reject** or **Escalate**. Asking costs no clock time; a **Source Trace** costs one minute, a **Replication Check** three, a **Decomposition Check** four, and an escalation to a colleague five, twice per run. What was asked, what came back, which claims the student marked used and what stance each carried is written to the run's trace and shown to you in the replay's **Delegation log**.

**What it refuses.** The assistant answers inside the scenario and does not leave it. It never says whether a claim is defective, never names the warranted stance, the evidence status, the failure family or the planted flag, and never shows the question bank or the expected-answer notes; a request to audit its own answers, to grade the run, or to reveal its instructions gets an in-scenario reply that names none of those. It draws no conclusion about the student and treats nothing as misconduct. Everything a student is not shown before their run is scored stays behind the reviewer's screens: the replay's **Package** view and the version page are where you read it.

**When the model does not answer.** If the model provider fails, times out, or the usage budget is spent, the student's run pauses on the spot. They see **The run is paused**, **The assistant did not answer.** and **Your clock stopped when it happened, and the time this pause takes is given back to you when you resume. Nothing you have done is lost.**, with one button, **Resume the run**. The Delegation Log keeps the failed request as **No answer came back. The run paused, your clock stopped, and the time was given back when you resumed.**, and the next request answers as usual. In the replay's **Trace** view the pause is the pair **Run paused** and **Run resumed**. The **Test controls** panel on the replay's **Actions** view arms exactly one such outage on a live run (**Arm the outage**), for step 7 of the walkthrough; the student is never told that a control did it.

**Scripted mode.** When the deployment runs with `FEATURE_AI=false`, which is the default, or with `LLM_PROVIDER=mock`, every model call is answered by the built-in scripted assistant: the same request always gets the same reply, each reply carries the scenario's claims verbatim and no figures of its own, no run text leaves the server, and it costs nothing. Every screen works exactly as it does with a live model, and by design nothing on a student screen says which mode is running; the platform admin's **Flags** page says it, and the generation screen prices the seven steps at **US$0.00, on the mock provider**. A demo runs end to end on the scripted assistant; the walkthrough was built for it.

**Bands are drafts until you decide.** After the defense, Tassl drafts the seven bands — Framing, Delegation, Verification, Calibration, Decision Quality, Adaptation and Ownership — each with the graphs, trace events and quoted words it was read from. Bands that turn on the model's reading of the student's free text carry **Provisional** until you decide them. The student's debrief shows every one as **Draft band** with the sentence **Every band below is a draft. Your instructor reads the run and confirms or changes each one; when they do, this page shows what they decided in place of the draft.** Nothing reaches a gradebook until all seven carry your decision; the seventh decision writes course export version 1. When the model could not place the bands the run is held: the Bands view reads **Nothing could place this run’s bands, so there are no drafts to decide. The seven are yours to set by hand.**, and you either band it by hand or void it. A correction on a claim can raise a band and never lowers one.

**Generation is drafting.** **Create and generate** writes a package from a seed case in seven model steps; every element it writes is a draft until you read it and record a decision. **Rewrite** asks for a new draft of a whole set of elements, keeps what you have already confirmed, and puts everything else in that set back to undecided.

## Troubleshooting & FAQ

**The sign-in page says Too many attempts and a number of seconds.** Sign-in, sign-up, password reset and verification resends are limited to ten a minute per address. Wait the seconds it names, then click **Sign in** again. Typing the password wrong ten times in a row is what usually earns it.

**I was sent back to Sign in to Tassl in the middle of a task.** Your session ended: a session lasts thirty days, changing your password on another device signs every other device out, and a platform-role change signs you out everywhere. Sign in again; the address you were on is kept and you return to it.

**The first page after a quiet spell takes a few seconds, or shows Something went wrong.** In production the database compute sleeps after five idle minutes and the first request wakes it, which measured 2.2 seconds against 0.16 seconds warm. Press **Try again** once and the page loads; nothing you saved is lost.

**A package will not confirm.** The refusal names the reason. **Every element needs a decision before the version can be confirmed.** — **Waiting on a decision** lists the undecided elements; a rejected element blocks until it is rewritten or saved. **Confirm you have read the teaching note first.** — tick **Teaching note checked against the answer space and claims**. **This package does not yet meet the scenario rules.** — **Rules this package does not meet yet** lists each rule with the elements it names; put them right by hand or with **Rewrite**. **This version is confirmed, so it can no longer be changed.** — the version is frozen; a change is a new version.

**A course, an assignment or a replay answers Not found.** Tassl answers **Not found** rather than refusing: the course belongs to an institution you are not an instructor in, the address is wrong, or, for a replay, you hold no **Instructor** or **Teaching assistant** row on the run's section roster. The **Course exports** page says **Replay needs a place in the section** in that last case. Add yourself to the section roster and open it again.

**A student's run does not appear on Review.** The queue lists runs at **Scored** for sections where you hold a roster row; a run that is still in progress is not there yet, and a run you have confirmed has left it. Open the assignment page for the run's state and its **Open the replay** link, or the assignment's **Course exports** for **Open the replay** on a confirmed run.

**New assignment is greyed out.** The line under it says why: **An assignment belongs to a section. Add a section to this course first.** or **An assignment runs on a confirmed scenario package version. Confirm one, then configure the assignment.**

**The assignment page says The setup is fixed.** A run has started on the assignment, so the package version, the variant, the working clock and the weight cannot change; the name, the **Walkthrough** switch and **Opens at** still can. Create another assignment for a different setup.

**A run shows Under review, Needs a hand, or the notification A run is held for review.** Tassl could not draft the bands (the model did not answer, the usage budget was spent, or a reading failed). The student sees **Your run is under review by your instructor**. Open the replay: the Bands view offers **Band this run by hand**, which opens the Actions view's **Put these seven on the record**; or void the run with the reason **Nothing could place the bands, and they could not be set by hand**.

**What a void does to exports.** A voided run keeps no partial result and no export: the replay reads **This run is voided. It carries no partial result, and no export written afterwards names it.**, its earlier download links answer **That export version does not exist for this run.**, and the dialog warns **This run is already exported. Voiding it withdraws that figure — no export version will name the run afterwards, so take the run out of the gradebook of record as well.** Tick **Offer the student another run** to give them a fresh attempt on the other variant; their list then shows **This attempt was voided.** and **Continue on attempt 2**.

**A download answered Too many requests.** **Download my data** allows two downloads an hour and answers **You can download your data twice an hour. Try again shortly.** past that. Every other write is limited to sixty a minute per person and answers **Too many requests. Try again shortly.**; wait a minute and repeat the action.

**The run states, in order.** A run's chip reads **Not started**, **Readiness Check**, **Framing**, **Working** (or **Paused** during an outage), **Decision locked**, **Turn open**, **Turn locked**, **Defense**, **Defense complete**, **Scored**, **Confirmed** and **Recorded**; a voided run reads **Voided**, and a held run reads **Under review** on the assignment page. **Scored** means the seven drafts are waiting for you; **Confirmed** means all seven carry your decision and export version 1 exists; **Recorded** means the student has answered the two debrief questions.

**Deleting a run.** Only a run on an assignment with the **Walkthrough** switch on has a **Delete** control on the assignment's Runs table; any other run answers **Only a run on a walkthrough assignment can be deleted. A run that counts is voided instead.**

## Glossary

- **Student** — the seat that takes a Decision Run; it sees Home and Runs and never sees a variant, a warranted stance, evidence status, a failure family, a planted flag, the question bank or another student's run before its own run is scored.
- **Instructor** — the seat that creates courses, sections and assignments, reads replays, decides bands, enters corrections, voids runs and exports results; it also authors packages.
- **Scenario author** — the seat that authors and confirms scenario packages without teaching a course; it sees Home and Packages.
- **Teaching assistant** — a section seat that decides bands the instructor has not decided; voiding, corrections and test controls stay with the instructor.
- **Platform admin** — the seat that manages platform roles, reads the Flags page and the audit log under Admin.
- **Institution** — the organization a course, a section, a package and a membership belong to; the header names it and offers Switch institution when you have more than one.
- **Course** — the unit that carries the outside-AI policy, the default run weight, the taught concepts and the band-to-points mapping, with the views Sections, Assignments, Policy and Mapping.
- **Section** — a roster inside a course; every assignment belongs to one section and a student needs a row on its roster before a run can start.
- **Assignment** — a section's pointer at one confirmed scenario package version, with a variant, a working clock, a weight, an opening time and the Walkthrough switch; a run starts from it.
- **Decision Run** — one student's single pass through one scenario: Readiness Check, frame, working period with the assistant, filed decision, the Turn, the defense, scoring, debrief and record.
- **Scenario package** — one decision case, versioned: the brief, the Evidence Room documents, the stakeholders, the answer space, the named fields, the claims with their variant states, the Sycophancy probe, the Turn, the question bank, the counterfactual, the readiness items, the clock and the seed record.
- **Version** — one frozen text of a package; an assignment runs on exactly that text, and a change means a new version.
- **Element** — one piece of a version that an author confirms, edits or rejects on its own in the confirmation workspace.
- **Seed case** — the licensed case a package is adapted from, with its title, publisher, license terms, the re-skin log and the confirmation that the license permits adaptation; no student ever sees it.
- **Family key** — the lowercase identifier a package keeps across its versions and exports; no two packages in one institution share it.
- **Generation** — the seven model steps that draft a version from its seed case; every element they write is a draft until an author decides on it.
- **Confirmation workspace** — the screen where an author reads each element, uses Save edits, Confirm, Reject or Rewrite, ticks the teaching-note check and confirms the version with Confirm and freeze.
- **Variant** — one of the two readings of a package, Defective or Sound, that differ only in the planted claim's evidence status and verification results; the student is never told which one they drew.
- **Claim** — something the assistant states that a student takes a stance on; each has a key such as C3, a source, an importance, a consequence and a verification cost.
- **Stance** — the position a student takes on a claim before the outcome is known: Accept, Verify, Challenge, Reject or Escalate.
- **Warranted stance** — the stance the authored material deserved on a claim in a variant, confirmed by the author and shown to the student only in the debrief.
- **Delegation Log** — the student's record of every request to the assistant, what came back, why they asked, and which claims they marked used.
- **Evidence Room** — the six to twelve dated, attributed documents of a scenario, open to the student in any order with no hints or summary.
- **Readiness Check** — sixteen questions in eight minutes before the scenario opens; it is not scored, never blocks the run, and closes with a concept map.
- **Frame** — the student's decision in fifty words, three load-bearing assumptions, a position and a confidence number, locked permanently before the assistant unlocks and the working clock starts.
- **Decision brief** — the student's recommendation, rationale, assumptions, what would change their mind, a confidence number and the figures they are betting on, filed with Lock the decision.
- **File the decision** — the irreversible act behind the button Lock the decision and the dialog File this decision?; the page that follows is Decision locked, and a claim the student leaned on without a stance refuses the lock.
- **Addendum** — up to fifty words a student adds once after filing the decision; it sits beside the decision and never becomes part of it.
- **The Turn** — one piece of new information that arrives sixty to one hundred and twenty seconds after the decision is filed and reopens the assistant and the Evidence Room for twelve minutes; the student files Hold, Revise or Reverse.
- **The defense** — six to nine typed questions drawn from the student's own run, answered with no assistant and no Evidence Room; an unsourced answer earns a follow-up.
- **Trace** — every timestamped event of a run in the order it was written, shown on the replay's Trace view and exported with the record.
- **Band** — one of four descriptive levels, Novice, Developing, Proficient or Professional, on each of the seven dimensions; Unassessed leaves a dimension out of the arithmetic.
- **Dimension** — one of the seven things a run is read on: Framing, Delegation, Verification, Calibration, Decision Quality, Adaptation and Ownership.
- **Draft and confirmed** — a band is a draft with its evidence until the instructor confirms it, records a different band, or marks the dimension Unassessed; the run is Confirmed once all seven carry a decision.
- **Debrief** — the student's Run Debrief, which walks the run in order and shows each band as Draft band until it is confirmed, then the instructor's decision and note in its place, and asks two written questions.
- **Judgment Record** — the student's downloadable JSON of one confirmed run: the four graphs, the confirmed bands with their evidence and notes, the mode, the variant and the trace, with no weight, mapping or points.
- **Escalation** — the student's one-sentence hand-off of a claim to a colleague inside the run, which costs five minutes of clock and is offered twice per run.
- **Correction** — the instructor's act of taking a claim Tassl got wrong out of one run's arithmetic; Verification and Calibration are read again, a band can rise and never falls, and a new export version is written.
- **Void** — the instructor's act of ending a run that cannot be scored; it keeps no partial result and no export, and can re-offer another run.
- **Re-offer** — the fresh attempt a void offers, on the other variant unless the instructor chooses one; the student's list shows Continue on attempt 2.
- **Replay** — the instructor's view of one run with the views Overview, Bands, Trace, Package and Actions, reached from Review, from the assignment's Runs table, or from Course exports.
- **Mapping** — the course's band-to-points table, Novice 1, Developing 2, Proficient 3 and Professional 4 by default; applying a change re-exports every confirmed run.
- **Points** — the mean of a run's mapped bands over the dimensions it was assessed on, written into the course export beside the bands and the mapping; never shown on the Judgment Record.
- **Weight** — what one run is worth in the gradebook, set on the course as Default run weight and overridable on the assignment.
- **Outside-AI policy** — the course's Open, Declared or In-Environment Only setting; Tassl displays it, never enforces it, and a declaration never changes a band or a point.
- **Course export** — the versioned JSON per run, written when all seven bands are decided and again after every correction, override, unassessed decision or mapping change; it carries the bands, the mapping and the points for the gradebook of record.
- **Walkthrough** — the seventeen-step demonstration of one Decision Run on the running product; as an assignment switch, it marks a practice assignment whose runs can be deleted rather than voided.
- **Uncalibrated** — the chip on every package and run in this build: no cohort has run the scenario, so the clock and difficulty are the author's estimate.
- **Working clock** — the package's clock, twenty-five minutes on Meridian Roast, that starts when the frame is locked and is charged by checks and escalations; when it runs out the decision is filed as it stands.
- **Test controls** — the instructor-only panel, present where FEATURE_TEST_CONTROLS is on, that arms one assistant outage in a live run for step 7 of the walkthrough.

Verified by automated tests: 2026-09-10, commit a70a72b
