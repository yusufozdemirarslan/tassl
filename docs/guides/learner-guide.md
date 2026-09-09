# Tassl Student Guide

## Who this is for

You are a Student on a course that uses Tassl. Your instructor assigns you a Decision Run: one consequential business decision, taken with an AI assistant in the room and under a clock you cannot pause. Tassl records what you do as a trace, drafts seven bands from it, and your instructor confirms them.

This guide walks one complete Decision Run on the seeded scenario, Meridian Roast, as the seat **student1@tassl.local** at Walkthrough University, then shows the account screens. Every label in **bold** is the exact text on the screen, and every value you type is given in full so you can copy it.

You need a browser, the address of the Tassl installation, and the seed password named in Getting started. You do not need to know anything about how Tassl works inside.

Tassl treats nothing it observes as misconduct. There is no total score, no rank and no percentile anywhere in the product, and declaring an outside tool never changes a band or a point.

## Getting started

**Signing in.** Open the installation's address (locally `http://localhost:3000`, in production `https://tassl.vercel.app`). Tassl sends a signed-out visitor to **Sign in to Tassl**. Sign in with the email address **student1@tassl.local** (the seat "Student One", a Student in section A of the course "Marketing Strategy Walkthrough" at Walkthrough University). The password is the seed password: on a local build and in CI it is **Walkthrough-Pass-2026** (the value of `SEED_PASSWORD` in `.env.test`); in production it is the value of the Vercel production variable `SEED_PASSWORD`, also kept in `~/.config/tassl/seed-password.txt` on the builder's machine. This guide does not print the production password. **Keep me signed in** is ticked by default; a session lasts 30 days.

**The first screen.** After sign-in you land on **Home**. The line above the heading names your institution, **Walkthrough University**; the heading is **Home** and the sentence under it reads **What needs your attention, and what is coming up.** The one panel a Student has is **Your runs**: a table with the columns **Assignment**, **Attempt**, **State** and **Next**, listing every assignment in your sections. Before you start anything, each row reads **Not started** in both **Attempt** and **State**, and **Next** offers **Start**. The seeded seat has three rows: **Decision Run 1 (walkthrough)**, **Decision Run 1 (sound)** and **Auto-lock test run**. A link **All runs** appears on this panel only when there are more than five rows.

**Navigation map.** Everything a Student can reach, in the order it appears:

- **Skip to main content** — the first link on every page; it is visible when you reach it with the Tab key and jumps past the header.
- **Home** (rail) — the page above.
- **Runs** (rail) — every assignment and where your run on it has got to; the **Next** column carries **Start**, **Continue**, **Respond to the Turn**, **Defend the decision**, **Read the debrief** or **Open the Judgment Record**, whichever fits the run's state.
- **Walkthrough University** (header) — the institution you are working in. A **Switch institution** menu appears here only when you belong to two or more.
- **Notifications** (the bell in the header) — what Tassl has told you, newest first, with an unread count on the bell.
- **Account** (the person icon in the header) — a menu with **Settings** (the tabs **Profile**, **Security** and **Data**) and **Sign out**.
- Inside a run, a band stays at the top of every screen with the assignment's name, a chip naming the run's state (**Framing**, **Working**, **Paused**, **Decision locked**, **Turn open** and so on) and the clock that is running. The rail stays in place.

A Student does not see **Courses**, **Review**, **Packages** or **Admin**; those rail items belong to other seats.

**Refreshing, the back button and a closed tab.** A run keeps its place: leave it and come back to the same step. Every run address you open is redirected to the screen the run is on, so refreshing, pressing back, or closing the tab and opening **Runs** again brings you to the same screen. The clocks are server time: the page only polls the server every five seconds and displays what it reads, so a closed tab does not stop a clock and a refresh does not restart one. The decision brief saves as you type (the line **Saved.** beside **Lock the decision**). What you have typed into the Turn response and into a defense answer is kept in the browser tab only until you submit it; the screen says so when it puts a draft back. A document you had open in the Evidence Room is closed when you leave the tab, because Tassl records how long each document stays open. If your session has ended, Tassl shows the sign-in page and returns you to the page you were on once you sign in.

## Tasks

### Task 1: Sign in and see your runs

*Goal:* Sign in as the seeded Student, read the Home page, and find the assignment you will run.

*Steps:*

1. Open the address **/sign-in** in your browser. → You see: the heading **Sign in to Tassl** and the sentence **Use the email address your institution knows you by.**
   ![Task 1 step 1](screenshots/student/task-01-step-01.png)
2. Type **student1@tassl.local** in **Email address**. → You see: the address in **Email address**.
   ![Task 1 step 2](screenshots/student/task-01-step-02.png)
3. Type the seed password in **Password** (**Walkthrough-Pass-2026** locally; see Getting started). → You see: **Keep me signed in** ticked beneath the fields.
   ![Task 1 step 3](screenshots/student/task-01-step-03.png)
4. Click **Sign in**. → You see: the heading **Home**, the line **Walkthrough University** above it, and the panel **Your runs** listing **Decision Run 1 (walkthrough)**.
   ![Task 1 step 4](screenshots/student/task-01-step-04.png)
5. Find the rail beside the page, starting with **Home**. → You see: two items, **Home** and **Runs**, and nothing else in the rail.
   ![Task 1 step 5](screenshots/student/task-01-step-05.png)
6. Find the header, which starts with the link **Tassl**. → You see: **Walkthrough University**, the **Notifications** bell and the **Account** button.
   ![Task 1 step 6](screenshots/student/task-01-step-06.png)
7. Click **Runs** in the rail. → You see: the heading **Runs** and a table with the columns **Assignment**, **Attempt**, **State** and **Next**.
   ![Task 1 step 7](screenshots/student/task-01-step-07.png)
8. Find the row **Decision Run 1 (walkthrough)**. → You see: **Not started** in **Attempt** and in **State**, the chip **Walkthrough**, and the button **Start** in **Next**.
   ![Task 1 step 8](screenshots/student/task-01-step-08.png)

*If something goes wrong:*

- "That email address and password do not match an account." means the address or the password is wrong for this installation. Locally the password is **Walkthrough-Pass-2026**; in production it is the value of `SEED_PASSWORD`, not the local one.
- "Too many attempts. Try again in {seconds} seconds." means ten sign-in attempts were made from your address inside a minute. Wait the number of seconds shown, then sign in again.
- "Waiting for an invitation" on Home means this account belongs to no institution yet. Sign in with **student1@tassl.local**, which is seeded into Walkthrough University.

### Task 2: Start a run and read what it counts for

*Goal:* Start Decision Run 1 (walkthrough) and read every section of Before you begin. Do this after Task 1.

*Steps:*

1. Click **Runs** in the rail. → You see: the heading **Runs**.
   ![Task 2 step 1](screenshots/student/task-02-step-01.png)
2. Click **Start** in the row **Decision Run 1 (walkthrough)**. → You see: the heading **Before you begin** and, under it, **This run counts toward the course grade. Run one counts.**
   ![Task 2 step 2](screenshots/student/task-02-step-02.png)
3. Find **Run type** in the first panel, under that sentence. → You see: **Run type** reading **Decision Run** and **Weight** reading **2.5 percent of the course grade**.
   ![Task 2 step 3](screenshots/student/task-02-step-03.png)
4. Scroll to **Outside AI tools**. → You see: **Declare what you use outside Tassl** and the sentence **A declaration never lowers a band or a point. Tassl does not detect, infer, or estimate outside use, and nothing it records is treated as misconduct.**
   ![Task 2 step 4](screenshots/student/task-02-step-04.png)
5. Scroll to **What a confirmed band is worth**. → You see: a table with **Band** and **Points**, the rows **Novice** 1, **Developing** 2, **Proficient** 3 and **Professional** 4, and the sentence **There is no total score, no rank, and no percentile anywhere in Tassl.**
   ![Task 2 step 5](screenshots/student/task-02-step-05.png)
6. Scroll to **The working clock**. → You see: **25 minutes**, the chip **Uncalibrated**, and **The clock starts when you lock your frame, not now. Reading the brief and the Evidence Room beforehand costs you nothing.**
   ![Task 2 step 6](screenshots/student/task-02-step-06.png)
7. Scroll to **The Readiness Check comes first**. → You see: **Sixteen short questions with an eight-minute limit. It is not scored, it never blocks the run, and you can skip past it if it will not submit.**
   ![Task 2 step 7](screenshots/student/task-02-step-07.png)
8. Click **Begin the Readiness Check**. → You see: the heading **Readiness Check** and a clock counting down from **08:00**.
   ![Task 2 step 8](screenshots/student/task-02-step-08.png)

*If something goes wrong:*

- "The run could not be started. Try again." means the request did not reach Tassl. Press **Start** once more; a run that did start shows **Continue** instead of **Start** on the row.
- "This assignment has not opened yet." means the instructor set an opening time that has not arrived; the row shows **Opens** and the time instead of **Start**.
- "Only a student on this assignment's section can start a run." means this account is not on the section that holds the assignment. Use **student1@tassl.local**, which is on section A.

### Task 3: Take the Readiness Check

*Goal:* Answer the sixteen items under the eight-minute clock, submit the check, and read what it found. Do this after Task 2.

*Steps:*

1. Find the clock beside **0 of 16 answered**. → You see: it counting down from **08:00**.
   ![Task 3 step 1](screenshots/student/task-03-step-01.png)
2. Find the **Items** toolbar under the clock. → You see: sixteen numbered buttons and the hint **The arrow keys move between items. An item you have answered is filled in.**
   ![Task 3 step 2](screenshots/student/task-03-step-02.png)
3. Choose the first of the four answers under **Item 1 of 16**. → You see: **1 of 16 answered** and the item's button in the toolbar filled in.
   ![Task 3 step 3](screenshots/student/task-03-step-03.png)
4. Click **Next item**. → You see: **Item 2 of 16**.
   ![Task 3 step 4](screenshots/student/task-03-step-04.png)
5. Answer items 2 to 16 the same way, moving on with **Next item** after each. → You see: **16 of 16 answered**.
   ![Task 3 step 5](screenshots/student/task-03-step-05.png)
6. Click **Submit the check**. → You see: the dialog **Submit the Readiness Check?** with **Every item has an answer. Submitting closes the check and opens the scenario.**
   ![Task 3 step 6](screenshots/student/task-03-step-06.png)
7. Click **Submit**. → You see: the heading **What the check read** and the sentence **There is no score here, no total and no comparison with anyone else, and nothing on this page counts toward your grade.**
   ![Task 3 step 7](screenshots/student/task-03-step-07.png)
8. Scroll to **The ideas this scenario turns on**. → You see: one sentence per idea, each starting **You showed a working grasp of**, ending **looks thin.** or starting **We could not tell about**, with no number anywhere on the page.
   ![Task 3 step 8](screenshots/student/task-03-step-08.png)
9. Click **Open the scenario**. → You see: the heading **The scenario** and **Read the brief and as much of the Evidence Room as you want to. The working clock starts when you lock your frame, so reading now costs you nothing.**
   ![Task 3 step 9](screenshots/student/task-03-step-09.png)

*If something goes wrong:*

- "That answer was not recorded. Choose it again." means one answer did not reach Tassl; the earlier answer is put back. Choose the option again.
- "Time is up. The check submitted itself with the answers you had given." means the eight minutes ran out. Nothing is lost and nothing follows from it; the page moves on to **What the check read** by itself.
- "If the check will not submit" with the button **Skip the check** appears only after a submit failed on Tassl's side. Press **Submit the check** once more; if it fails again, press **Skip the check**. The check is not scored, so skipping costs nothing.

### Task 4: Read the brief and open the Evidence Room

*Goal:* Read the scenario brief, open and close one document, and see that the assistant stays locked until you lock your frame. Do this after Task 3.

*Steps:*

1. Find **Scenario brief** at the top of the left column. → You see: the brief, beginning **Meridian Roast sells single-origin coffee by subscription.**
   ![Task 4 step 1](screenshots/student/task-04-step-01.png)
2. Scroll to **Evidence Room**. → You see: nine documents, each with its author and date, among them **Board minutes, 28 August 2026**, and the sentence **Tassl records which ones you open and how long each stays open; it draws no conclusion from that.**
   ![Task 4 step 2](screenshots/student/task-04-step-02.png)
3. Click **Open** beside **Board minutes, 28 August 2026**. → You see: the document's text beneath its title, and the button beside the title now reading **Close**.
   ![Task 4 step 3](screenshots/student/task-04-step-03.png)
4. Click **Close** beside **Board minutes, 28 August 2026**. → You see: the text gone and the button reading **Open** again.
   ![Task 4 step 4](screenshots/student/task-04-step-04.png)
5. Scroll to **AI assistant** in the right column. → You see: **The assistant unlocks the moment you lock your frame. It stays locked until then so that the position you write is yours.**
   ![Task 4 step 5](screenshots/student/task-04-step-05.png)
6. Scroll to **Your decision brief**. → You see: **The brief is what you hand in: a recommendation, the reasoning under it, and what would change your mind. It opens after you lock your frame.**
   ![Task 4 step 6](screenshots/student/task-04-step-06.png)

*If something goes wrong:*

- "That document did not open. Try it again." means the reading could not be recorded. Press **Open** again; every document is open to you, in any order, for as long as you like.
- "Opening the document…" that does not clear within a few seconds means the connection is slow. Wait; the text appears when it arrives, and no clock is running yet.
- "This scenario has no brief." or "Nothing to read here" means the assignment's scenario carries no brief or no documents; tell your instructor, because the seeded scenario carries both.

### Task 5: Lock your frame

*Goal:* Write the frame inside its word limits, lock it permanently, and watch the working clock start and the assistant unlock. Do this after Task 4.

*Steps:*

1. Scroll to **Your frame** in the right column. → You see: **The decision**, **Load-bearing assumptions** with **Assumption 1**, **Assumption 2** and **Assumption 3**, **Your position now**, **Confidence**, and a counter such as **0 of 50 words** under each text field.
   ![Task 5 step 1](screenshots/student/task-05-step-01.png)
2. Type **Guide decision, back the premium tier with most of the quarterly budget** in **The decision**. → You see: **12 of 50 words**.
   ![Task 5 step 2](screenshots/student/task-05-step-02.png)
3. Type **Guide assumption one, premium payback is under a year** in **Assumption 1**. → You see: **9 of 25 words**.
   ![Task 5 step 3](screenshots/student/task-05-step-03.png)
4. Type **Guide assumption two, value tier demand is flat** in **Assumption 2**. → You see: **8 of 25 words**.
   ![Task 5 step 4](screenshots/student/task-05-step-04.png)
5. Type **Guide assumption three, the board wants growth** in **Assumption 3**. → You see: **7 of 25 words**.
   ![Task 5 step 5](screenshots/student/task-05-step-05.png)
6. Type **Guide position, lean premium because the payback looks short** in **Your position now**. → You see: **9 of 100 words**.
   ![Task 5 step 6](screenshots/student/task-05-step-06.png)
7. Type **60** in **Confidence as a number**. → You see: **60** in the field and the slider **Confidence, 0 to 100** at the same place.
   ![Task 5 step 7](screenshots/student/task-05-step-07.png)
8. Click **Lock the frame**. → You see: the dialog **Lock the frame permanently?** with **A locked frame is never edited, replaced, or restored — not by you, and not by your instructor. Locking it unlocks the assistant and starts the working clock.**
   ![Task 5 step 8](screenshots/student/task-05-step-08.png)
9. Click **Lock it**. → You see: the chip **Working** in the band, a clock counting down from **25:00**, **Your frame** reading **Locked** with **Confidence at the frame** **60 of 100**, and the field **Your request** under **AI assistant**.
   ![Task 5 step 9](screenshots/student/task-05-step-09.png)

*If something goes wrong:*

- "This is part of the frame. Write something in it." under a field means that field is empty. Every field of the frame is required; fill it and press **Lock the frame** again.
- "This is over the limit. Cut it back to 50 words to lock the frame." (or 25 or 100) means the field is over its limit; the counter is red. Shorten it.
- "This run has already moved on. The screen is catching up." means the frame was already locked, from this or another tab. The screen refreshes to the working screen; nothing is lost.

### Task 6: Ask the assistant

*Goal:* Make your first request, read the claim it raises, write why you asked in the Delegation Log, and mark the claim as used. Do this after Task 5.

*Steps:*

1. Type **What is the premium payback?** in **Your request**. → You see: **28 of 2000 characters** and the hint **Ask in your own words. Asking costs you no clock time.**
   ![Task 6 step 1](screenshots/student/task-06-step-01.png)
2. Click **Ask the assistant**. → You see: **Reply complete. One claim surfaced.** and a card **Claim C3** reading **Premium payback is about 11 months, so the premium tier returns its acquisition cost inside the fiscal year.**
   ![Task 6 step 2](screenshots/student/task-06-step-02.png)
3. Scroll to **Delegation Log**. → You see: **Delegation 1** with **You asked** and your request, **The assistant answered** and its reply, and **Claims in this reply** listing **Claim C3**.
   ![Task 6 step 3](screenshots/student/task-06-step-03.png)
4. Type **Guide, checking the payback figure** in **Why you asked** under **Delegation 1**. → You see: **34 of 200 characters**.
   ![Task 6 step 4](screenshots/student/task-06-step-04.png)
5. Click **Save**. → You see: **Saved.**
   ![Task 6 step 5](screenshots/student/task-06-step-05.png)
6. Click **Mark as used** beside **Claim C3** under **Delegation 1**. → You see: the chip **Used** on the claim and the sentence **Marking a claim used records that you leaned on it. A mark stays on the record.**
   ![Task 6 step 6](screenshots/student/task-06-step-06.png)

*If something goes wrong:*

- "Write a request before sending it." means **Your request** is empty. Type the request, then press **Ask the assistant**.
- "That is a lot of requests in a short time. Try again in {seconds} seconds." means more than ten requests went to the assistant inside a minute. Wait the seconds shown; the working clock keeps running.
- "That did not save. Try it again." under **Why you asked** means the line did not reach Tassl. Press **Save** again; you can change the line while the run is open.

### Task 7: Take a stance on every claim

*Goal:* Take a stance on the claim you have, change it, raise three more claims with one request, and take a stance on each. Do this after Task 6.

*Steps:*

1. Find **Your stance** on the **Claim C3** card in the assistant's reply. → You see: five choices, **Accept**, **Verify**, **Challenge**, **Reject** and **Escalate**, and the hint **It costs no clock time, and you can change it while the run is open; both are kept.**
   ![Task 7 step 1](screenshots/student/task-07-step-01.png)
2. Click **Accept**. → You see: **Accept** selected on **Claim C3**.
   ![Task 7 step 2](screenshots/student/task-07-step-02.png)
3. Click **Verify**. → You see: **Verify** selected and the line **Changed from Accept.**
   ![Task 7 step 3](screenshots/student/task-07-step-03.png)
4. Click into **Your request**. → You see: the field empty and **0 of 2000 characters**.
   ![Task 7 step 4](screenshots/student/task-07-step-04.png)
5. Type **What is the price sensitivity, is the value tier saturated, and what did the survey find?** → You see: **89 of 2000 characters**.
   ![Task 7 step 5](screenshots/student/task-07-step-05.png)
6. Click **Ask the assistant**. → You see: **Reply complete. 3 claims surfaced.** and the cards **Claim C5**, **Claim C8** and **Claim C7**.
   ![Task 7 step 6](screenshots/student/task-07-step-06.png)
7. Click **Verify** under **Claim C5**. → You see: **Verify** selected on **Claim C5**.
   ![Task 7 step 7](screenshots/student/task-07-step-07.png)
8. Click **Accept** under **Claim C8**. → You see: **Accept** selected on **Claim C8**.
   ![Task 7 step 8](screenshots/student/task-07-step-08.png)
9. Click **Verify** under **Claim C7**. → You see: **Verify** selected on **Claim C7**.
   ![Task 7 step 9](screenshots/student/task-07-step-09.png)

*If something goes wrong:*

- "That stance was not recorded. Try it again." means the stance did not reach Tassl and the earlier one is put back. Choose it again.
- "You are taking a position on this claim in the reply above." on a claim in the Delegation Log means that claim's stance control is on the copy in the assistant's reply, not the log's. Use the card in the reply.
- "Reply complete. No claims surfaced." means the request matched nothing the assistant states; the reply says so in words. Ask in the terms of the scenario, as in the sentence above.

### Task 8: Check a claim and escalate one

*Goal:* Run a Source Trace on one claim, reject another, and escalate a third to a colleague. Do this after Task 7.

*Steps:*

1. Click **Check it** on **Claim C5**. → You see: a menu with **Source Trace** and its cost **1 min**.
   ![Task 8 step 1](screenshots/student/task-08-step-01.png)
2. Click **Source Trace**. → You see: a panel **Source Trace on claim C5** with **Document**, **Passage**, **Date** and **Author**, and **This check cost one minute of your working clock.**
   ![Task 8 step 2](screenshots/student/task-08-step-02.png)
3. Click **Close** on the panel. → You see: the panel gone and the button **Read it again** on **Claim C5**.
   ![Task 8 step 3](screenshots/student/task-08-step-03.png)
4. Click **Reject** under **Claim C8**. → You see: **Reject** selected and the line **Changed from Accept.**
   ![Task 8 step 4](screenshots/student/task-08-step-04.png)
5. Click the button **Escalate** beneath the stance row on **Claim C7**. → You see: the dialog **Escalate to a colleague** with **You have 2 escalations left in this run.** and **It costs five minutes of your working clock.**
   ![Task 8 step 5](screenshots/student/task-08-step-05.png)
6. Type **Guide, I cannot tell whether the survey sample was large enough** in **What you cannot settle**. → You see: **63 of 280 characters**.
   ![Task 8 step 6](screenshots/student/task-08-step-06.png)
7. Click **Send it**. → You see: on **Claim C7**, **You wrote** with your sentence, **They answered** beginning **Rowan Adeyemi, research operations.**, and **This escalation cost 5 minutes of your working clock.**
   ![Task 8 step 7](screenshots/student/task-08-step-07.png)
8. Click the button **Escalate** beneath the stance row on **Claim C5**. → You see: the dialog **Escalate to a colleague** with **You have one escalation left in this run.**
   ![Task 8 step 8](screenshots/student/task-08-step-08.png)
9. Click **Cancel**. → You see: the dialog gone and **Claim C5** unchanged.
   ![Task 8 step 9](screenshots/student/task-08-step-09.png)

*If something goes wrong:*

- "That check did not run. Try it again." means the check was not started and nothing was charged. Press **Check it** and choose it again.
- "Write at least three words." under **What you cannot settle** means the sentence is too short; it takes at least three words and at most 280 characters.
- "You have used both escalations in this run." means the two escalations a run allows are spent; the **Escalate** button stays off. The **Escalate** choice in the stance row still records a stance and costs nothing.

### Task 9: Declare outside-tool use

*Goal:* Record that you used something outside Tassl, and see that the declaration changes nothing about the run. Do this after Task 5.

*Steps:*

1. Scroll to **Declare outside-tool use** under the Delegation Log. → You see: **A declaration never lowers a band or a point. Tassl does not detect, infer, or estimate outside use, and nothing it records is treated as misconduct.**
   ![Task 9 step 1](screenshots/student/task-09-step-01.png)
2. Click the button **Declare outside-tool use**. → You see: the field **What you used, and what for** with the hint **One sentence is enough. At most 500 characters.**
   ![Task 9 step 2](screenshots/student/task-09-step-02.png)
3. Type **Guide, a calculator for the payback arithmetic** in **What you used, and what for**. → You see: **46 of 500 characters**.
   ![Task 9 step 3](screenshots/student/task-09-step-03.png)
4. Click **Record it**. → You see: **Recorded. It sits with the run and changes nothing about it.**
   ![Task 9 step 4](screenshots/student/task-09-step-04.png)

*If something goes wrong:*

- "Write what you used it for." means the field is empty. One sentence is enough.
- "That was not recorded. Try it again." means the declaration did not reach Tassl. Press **Record it** again.
- "The log cannot be written to while the run is paused." means the run is paused; press **Resume the run** in the dialog first (Task 15).

### Task 10: Write your decision brief and file it

*Goal:* Write every field of the brief, meet the refusal Tassl gives when a claim you leaned on has no stance, fix it, file the decision, and add the one addendum. Do this after Task 8.

*Steps:*

1. Scroll to **Your decision brief**. → You see: **It saves as you type; nothing is filed until you lock the decision.** and the fields **Your recommendation**, **Why**, **Load-bearing assumptions**, **What would change your mind**, **The figures you are betting on** and **Confidence**.
   ![Task 10 step 1](screenshots/student/task-10-step-01.png)
2. Type **Guide recommendation, move most of the budget to premium this quarter** in **Your recommendation**. → You see: **11 of 120 words**.
   ![Task 10 step 2](screenshots/student/task-10-step-02.png)
3. Type **Guide reasoning, the premium payback is short and retention is strong** in **Why**. → You see: **11 of 250 words**.
   ![Task 10 step 3](screenshots/student/task-10-step-03.png)
4. Type **Guide brief assumption one, payback stays near eleven months** in **Assumption 1**. → You see: **9 of 25 words**.
   ![Task 10 step 4](screenshots/student/task-10-step-04.png)
5. Type **Guide brief assumption two, premium retention holds** in **Assumption 2**. → You see: **7 of 25 words**.
   ![Task 10 step 5](screenshots/student/task-10-step-05.png)
6. Type **Guide brief assumption three, the value tier is saturated** in **Assumption 3**. → You see: **9 of 25 words**.
   ![Task 10 step 6](screenshots/student/task-10-step-06.png)
7. Type **Guide, a payback figure above sixteen months** in **What would change your mind**. → You see: **7 of 60 words**.
   ![Task 10 step 7](screenshots/student/task-10-step-07.png)
8. Type **60** in **Share of the quarter's acquisition budget going to premium, in percent**. → You see: **60** in the field, which takes digits only.
   ![Task 10 step 8](screenshots/student/task-10-step-08.png)
9. Type **11** in **Premium payback you are betting on, in months**. → You see: **Saved.** beside **Lock the decision**.
   ![Task 10 step 9](screenshots/student/task-10-step-09.png)
10. Type **62** in **Confidence as a number**. → You see: **Saved.** beside **Lock the decision**.
   ![Task 10 step 10](screenshots/student/task-10-step-10.png)
11. Type **What is the value tier payback?** in **Your request**. → You see: **31 of 2000 characters**.
   ![Task 10 step 11](screenshots/student/task-10-step-11.png)
12. Click **Ask the assistant**. → You see: **Reply complete. One claim surfaced.** and a card **Claim C1**.
   ![Task 10 step 12](screenshots/student/task-10-step-12.png)
13. Click **Mark as used** beside **Claim C1** under **Delegation 3**. → You see: the chip **Used** on **Claim C1** and, under **Lock the decision**, **One claim you leaned on has no stance yet. Filing asks for one on it.**
   ![Task 10 step 13](screenshots/student/task-10-step-13.png)
14. Click **Lock the decision**. → You see: the dialog **File this decision?** with **What will be filed** listing your recommendation and **Confidence 62 of 100**.
   ![Task 10 step 14](screenshots/student/task-10-step-14.png)
15. Click **File it**. → You see: the dialog now reads **A claim you leaned on has no stance**, shows **The claim** with the text of **Claim C1**, and offers **Back to the brief** and **Go to the claim**.
   ![Task 10 step 15](screenshots/student/task-10-step-15.png)
16. Click **Go to the claim**. → You see: the **Claim C1** card with the chip **No stance yet**.
   ![Task 10 step 16](screenshots/student/task-10-step-16.png)
17. Click **Accept** under **Claim C1**. → You see: **Accept** selected and the chip **No stance yet** gone.
   ![Task 10 step 17](screenshots/student/task-10-step-17.png)
18. Click **Lock the decision**. → You see: the dialog **File this decision?** with **What will be filed**.
   ![Task 10 step 18](screenshots/student/task-10-step-18.png)
19. Click **File it**. → You see: the heading **Decision locked**, **The decision you filed** with **Filed** and the time, **Confidence at the lock** **62 of 100**, **Premium payback you are betting on, in months** **11**, and **The frame you locked**.
   ![Task 10 step 19](screenshots/student/task-10-step-19.png)
20. Click **Add an addendum**. → You see: the dialog **Add an addendum** with the field **Your addendum** and the hint **At most 50 words. You can add one addendum per run.**
   ![Task 10 step 20](screenshots/student/task-10-step-20.png)
21. Type **Guide addendum, I would trace the payback figure before filing** in **Your addendum**. → You see: **10 of 50 words**.
   ![Task 10 step 21](screenshots/student/task-10-step-21.png)
22. Click **Add it**. → You see: **Your addendum** with your text, **Added** and the time, and **One addendum per run, and this run has its one. It is kept apart from the decision above.**
   ![Task 10 step 22](screenshots/student/task-10-step-22.png)

*If something goes wrong:*

- "One field is not ready" in the dialog means a field of the brief is empty or over its limit; the field is marked behind the dialog. Press **Go to the field**, fix it, and press **Lock the decision** again. Nothing was filed and nothing was lost.
- "This field takes a number. Digits, a decimal point, a minus sign." means letters were typed into one of **The figures you are betting on**. Type digits only.
- "The last change did not save. What is on screen is not lost; it saves again as you type." means one autosave failed; keep typing and the line returns to **Saved.**

### Task 11: Respond to the Turn

*Goal:* Wait for the Turn, take a stance on the claims it puts in front of you, and file a response inside the twelve-minute window. Do this after Task 10.

*Steps:*

1. Find the panel **The Turn** at the top of **Decision locked**. → You see: a clock **Time until the Turn** counting down and **A message from the world arrives shortly, and the run reopens for 12 minutes so you can hold, revise or reverse.**
   ![Task 11 step 1](screenshots/student/task-11-step-01.png)
2. Wait for **Time until the Turn** to reach zero, about 90 seconds after you filed. → You see: the heading **The Turn** and the panel **What arrived** with the chip **Stakeholder message**.
   ![Task 11 step 2](screenshots/student/task-11-step-02.png)
3. Find **Turn window** in the band at the top. → You see: a clock beside it counting down from **12:00**.
   ![Task 11 step 3](screenshots/student/task-11-step-03.png)
4. Read **What arrived**. → You see: a message beginning **Ellery here.** that says month-three retention is **61 percent**, and the line **Arrived** with the time.
   ![Task 11 step 4](screenshots/student/task-11-step-04.png)
5. Scroll to **What this puts in front of you**. → You see: **Claim C2** and **Claim C3**, each with **Your stance**, and **Filing a response asks for a position on each of them, and taking one costs nothing.**
   ![Task 11 step 5](screenshots/student/task-11-step-05.png)
6. Click **Verify** under **Claim C2**. → You see: **Verify** selected on **Claim C2**.
   ![Task 11 step 6](screenshots/student/task-11-step-06.png)
7. Click **Challenge** under **Claim C3**. → You see: **Challenge** selected and the line **Changed from Verify.**
   ![Task 11 step 7](screenshots/student/task-11-step-07.png)
8. Find **What you can work with** in the right column. → You see: **The assistant and the Evidence Room are open again until the window closes. Checks and escalations cost window time exactly as they cost clock time before the lock.** above **Evidence Room** and **AI assistant**.
   ![Task 11 step 8](screenshots/student/task-11-step-08.png)
9. Scroll to **What you filed before this arrived**. → You see: **The frame you locked** beside **The decision you filed**, neither of them editable.
   ![Task 11 step 9](screenshots/student/task-11-step-09.png)
10. Under **Your response**, click **Revise**. → You see: **Revise** selected, beside **The decision holds in direction, and something inside it changes.**
   ![Task 11 step 10](screenshots/student/task-11-step-10.png)
11. Type **Guide revision, the retention figure changed so the payback no longer holds** in **Why**. → You see: **12 of 150 words**.
   ![Task 11 step 11](screenshots/student/task-11-step-11.png)
12. Type **48** in **Confidence as a number**. → You see: **48** beside **of 100**.
   ![Task 11 step 12](screenshots/student/task-11-step-12.png)
13. Click **File the response**. → You see: the heading **The defense**.
   ![Task 11 step 13](screenshots/student/task-11-step-13.png)

*If something goes wrong:*

- "A claim the Turn put in front of you has no stance yet: “{text}” Take one on it and file again." means one of the window's claims has no stance. Press **Go to the claim**, choose a stance, and press **File the response** again; what you typed in **Why** stays.
- "Choose one of the three." or "Say why. This is part of the response." means the response or **Why** is missing. Both are required, and **Why** takes at most 150 words.
- "The Turn window has closed." means the twelve minutes ended before you filed. The decision you already filed stands, and the defense opens next; the defense shows **The window closed without a response, so the decision you had already filed stands.**

### Task 12: Answer the defense

*Goal:* Answer the questions about your own run with no assistant and no Evidence Room, meet a follow-up, and finish the defense. Do this after Task 11.

*Steps:*

1. Read the sentence under the heading **The defense**. → You see: **There is no assistant here and no Evidence Room** in it, and no **AI assistant**, **Evidence Room** or **Delegation Log** panel on the page.
   ![Task 12 step 1](screenshots/student/task-12-step-01.png)
2. Scroll to **Questions**. → You see: **There is no clock on this stage; nothing runs out and nothing is taken away.**, the caption **Question 1** over the first question, and the field **Your answer**.
   ![Task 12 step 2](screenshots/student/task-12-step-02.png)
3. Type **I went with what I remembered and did not note where it came from.** in **Your answer**. → You see: **66 of 5000 characters**.
   ![Task 12 step 3](screenshots/student/task-12-step-03.png)
4. Click **Submit answer**. → You see: your answer under the question with **Answered** and the time, and beneath it the caption **Follow-up** over a second question with a fresh **Your answer**.
   ![Task 12 step 4](screenshots/student/task-12-step-04.png)
5. Answer all but the last question with **Guide, 16 months because the memo says so** via **Submit answer**. → You see: one question left with an empty **Your answer**.
   ![Task 12 step 5](screenshots/student/task-12-step-05.png)
6. Scroll to **What you filed** in the right column. → You see: **Your addendum**, and **Your Turn response** with **Revise**, your **Why**, and **Confidence after the Turn** **48 of 100**.
   ![Task 12 step 6](screenshots/student/task-12-step-06.png)
7. Click **Finish the defense**. → You see: the dialog **Finish the defense?** with **The defense is filed once and is not reopened. Your run goes to scoring from here.** and **One question has no answer. Unanswered questions count as no answer, and are filed empty.**
   ![Task 12 step 7](screenshots/student/task-12-step-07.png)
8. Click **Finish it**. → You see: the heading **Run status**.
   ![Task 12 step 8](screenshots/student/task-12-step-08.png)

*If something goes wrong:*

- "The answer was not recorded. Try it again." means the answer did not reach Tassl. Press **Submit answer** again; an answer is filed once and is not edited again.
- "This is over the limit. Cut it back to 5000 characters to submit it." means the answer is too long. Shorten it.
- "The defense was not finished. Try it again." means the close did not go through. Press **Finish the defense** again; if it adds **Some answers were filed before this stopped. Nothing you had already answered has changed.**, nothing you answered was lost.

### Task 13: Read your result and your debrief

*Goal:* Watch the run be scored, read the draft debrief, then read the confirmed debrief and answer its two questions once your instructor has confirmed the bands. Do this after Task 12; the confirmation is your instructor's act on the replay's Bands tab.

*Steps:*

1. Find the heading under **Run status**. → You see: **Your run is being scored** (or, if scoring has already finished, **Your debrief is ready**).
   ![Task 13 step 1](screenshots/student/task-13-step-01.png)
2. Wait on **Run status** for scoring to finish, a few seconds. → You see: **Your debrief is ready**, **The bands in it are drafts until your instructor confirms them**, and the link **Read the debrief**.
   ![Task 13 step 2](screenshots/student/task-13-step-02.png)
3. Click **Read the debrief**. → You see: the heading **Run Debrief**, the chip **Draft**, and **Every band below is a draft. Your instructor reads the run and confirms or changes each one; when they do, this page shows what they decided in place of the draft.**
   ![Task 13 step 3](screenshots/student/task-13-step-03.png)
4. Scroll down **Run Debrief** from top to bottom. → You see: twelve sections in this order, **Your frame beside your decision**, **Claim by claim**, **Defects the decision rested on**, **Where the assistant changed its position**, **Your confidence through the run**, **The Turn beside your frozen frame**, **Where the clock went**, **How this run could have gone**, **The seven dimensions**, **What your course does with the bands**, **One thing this run did** and **Two questions**.
   ![Task 13 step 4](screenshots/student/task-13-step-04.png)
5. Scroll to **The seven dimensions**. → You see: seven cards, **Framing**, **Delegation**, **Verification**, **Calibration**, **Decision Quality**, **Adaptation** and **Ownership**, each labelled **Draft band**.
   ![Task 13 step 5](screenshots/student/task-13-step-05.png)
6. Scroll to **What your course does with the bands**. → You see: **Provisional points, draft** and **No draft band reaches a gradebook, and this number is in no export.**
   ![Task 13 step 6](screenshots/student/task-13-step-06.png)
7. Open **Runs** after your instructor has confirmed the bands. → You see: the row **Decision Run 1 (walkthrough)** with **Confirmed** in **State** and **Read the debrief** in **Next**.
   ![Task 13 step 7](screenshots/student/task-13-step-07.png)
8. Click **Read the debrief**. → You see: the chip **Confirmed** and **Your instructor has read this run. Each band below is what they decided, with any note they wrote.**
   ![Task 13 step 8](screenshots/student/task-13-step-08.png)
9. Scroll to **The seven dimensions**. → You see: **Confirmed band** on every card and **Your instructor wrote** under each, followed by the note or **Your instructor wrote no note on this dimension.**
   ![Task 13 step 9](screenshots/student/task-13-step-09.png)
10. Scroll to **Two questions**. → You see: the fields **Which single stance would you change, and to what?** and **What will you do differently in the next run like this?**, each with **Up to 100 words.**
   ![Task 13 step 10](screenshots/student/task-13-step-10.png)
11. Type **Guide, Verify on C5 to Challenge** in **Which single stance would you change, and to what?** → You see: **6 / 100 words**.
   ![Task 13 step 11](screenshots/student/task-13-step-11.png)
12. Type **Guide, trace every figure first** in **What will you do differently in the next run like this?** → You see: **5 / 100 words**.
   ![Task 13 step 12](screenshots/student/task-13-step-12.png)
13. Click **File both answers**. → You see: your two answers read back with **Answered** and the time, and **Both answers are filed and this run is closed.**
   ![Task 13 step 13](screenshots/student/task-13-step-13.png)

*If something goes wrong:*

- "Your run is under review by your instructor" on **Run status** means scoring could not place every band on its own and a person must read the run first. Nothing is asked of you; the debrief opens when your instructor confirms.
- "Write something in both boxes before filing." or "This answer runs past 100 words." means one of the two answers is empty or too long. Both are required, at most 100 words each.
- "Only the student who took this run can answer these two questions." appears when a reviewer opens your debrief; it is not shown to you. If you see it, you are signed in as another seat.

### Task 14: Open your Judgment Record

*Goal:* Open the record of your confirmed run, read the four graphs and the seven dimensions, download it, and tell the illustrative panel apart from your own record. Do this after Task 13.

*Steps:*

1. Click **Runs** in the rail. → You see: the row **Decision Run 1 (walkthrough)** with **Recorded** in **State** and **Open the Judgment Record** in **Next**.
   ![Task 14 step 1](screenshots/student/task-14-step-01.png)
2. Click **Open the Judgment Record**. → You see: the heading **Judgment Record**, the line **Bands confirmed** with the time, and the button **Download record**.
   ![Task 14 step 2](screenshots/student/task-14-step-02.png)
3. Scroll to **The four graphs**. → You see: **Confidence line**, **Clock timeline**, **Stance matrix** and **Frame beside decision**, each with a button **Show data table**.
   ![Task 14 step 3](screenshots/student/task-14-step-03.png)
4. Click **Show data table** under **Stance matrix**. → You see: a table with the columns **Stance taken** and **Stance warranted** in place of the graph, and the button now reading **Show graph**.
   ![Task 14 step 4](screenshots/student/task-14-step-04.png)
5. Scroll to **The seven dimensions**. → You see: seven cards each labelled **Confirmed band**, with **Your instructor wrote** under each.
   ![Task 14 step 5](screenshots/student/task-14-step-05.png)
6. Scroll to **How this run was set up**. → You see: **Mode** reading **Standard** and **Variant** reading **Defective**.
   ![Task 14 step 6](screenshots/student/task-14-step-06.png)
7. Find the sentence under **Download record**. → You see: **A JSON file of this run: the events, the graphs and the confirmed bands. It carries no course arithmetic, so nothing in it is a grade.**
   ![Task 14 step 7](screenshots/student/task-14-step-07.png)
8. Click **Download record**. → You see: your browser saving a file named tassl-record- followed by the run id and .json.
   ![Task 14 step 8](screenshots/student/task-14-step-08.png)
9. Scroll to **Four-run trajectory** at the bottom of the page. → You see: the label **Illustrative sample data** and **These four runs are invented and describe no student, including you.**
   ![Task 14 step 9](screenshots/student/task-14-step-09.png)

*If something goes wrong:*

- Opening the record's address before the bands are confirmed sends you to **Run status**; the record exists from **Confirmed** onward. Wait for **Your instructor has confirmed the bands**.
- "This graph is not available for this run. Missing events: {types}." means the trace lacks the events that graph is plotted from. The other graphs and the bands are unaffected.
- No **Four-run trajectory** panel at all means the installation runs with the illustrative panels switched off. Your own record above is complete without it.

### Task 15: Continue after an assistant outage

*Goal:* See what happens when the assistant does not answer: on a second run, after you lock the frame, your instructor arms one assistant outage from the replay's Actions tab (a test control), and your next request meets it. Do this after Task 1.

*Steps:*

1. Click **Runs** in the rail. → You see: the row **Decision Run 1 (sound)** with **Start** in **Next**.
   ![Task 15 step 1](screenshots/student/task-15-step-01.png)
2. Click **Start** in the row **Decision Run 1 (sound)**. → You see: the heading **Before you begin**.
   ![Task 15 step 2](screenshots/student/task-15-step-02.png)
3. Click **Begin the Readiness Check**. → You see: the heading **Readiness Check** and **0 of 16 answered**.
   ![Task 15 step 3](screenshots/student/task-15-step-03.png)
4. Click **Submit the check**. → You see: the dialog **Submit the Readiness Check?** with **16 items have no answer. Submitting closes the check and opens the scenario; an item left blank simply leaves its idea unread.**
   ![Task 15 step 4](screenshots/student/task-15-step-04.png)
5. Click **Submit**. → You see: the heading **What the check read**.
   ![Task 15 step 5](screenshots/student/task-15-step-05.png)
6. Click **Open the scenario**. → You see: the heading **The scenario**.
   ![Task 15 step 6](screenshots/student/task-15-step-06.png)
7. Type **Guide outage decision, hold the budget split** in **The decision**. → You see: **7 of 50 words**.
   ![Task 15 step 7](screenshots/student/task-15-step-07.png)
8. Type **Guide outage assumption one** in **Assumption 1**. → You see: **4 of 25 words**.
   ![Task 15 step 8](screenshots/student/task-15-step-08.png)
9. Type **Guide outage assumption two** in **Assumption 2**. → You see: **4 of 25 words**.
   ![Task 15 step 9](screenshots/student/task-15-step-09.png)
10. Type **Guide outage assumption three** in **Assumption 3**. → You see: **4 of 25 words**.
   ![Task 15 step 10](screenshots/student/task-15-step-10.png)
11. Type **Guide outage position, hold** in **Your position now**. → You see: **4 of 100 words**.
   ![Task 15 step 11](screenshots/student/task-15-step-11.png)
12. Click **Lock the frame**. → You see: the dialog **Lock the frame permanently?**
   ![Task 15 step 12](screenshots/student/task-15-step-12.png)
13. Click **Lock it**. → You see: the chip **Working** in the band and the field **Your request** under **AI assistant**.
   ![Task 15 step 13](screenshots/student/task-15-step-13.png)
14. Type **What is the premium payback?** in **Your request**. → You see: **28 of 2000 characters**.
   ![Task 15 step 14](screenshots/student/task-15-step-14.png)
15. Click **Ask the assistant**. → You see: the dialog **The run is paused** with **The assistant did not answer.** and **Your clock stopped when it happened, and the time this pause takes is given back to you when you resume. Nothing you have done is lost.**
   ![Task 15 step 15](screenshots/student/task-15-step-15.png)
16. Click **Resume the run**. → You see: the dialog gone, the chip **Working** in the band, and in **Delegation Log** an entry reading **No answer came back. The run paused, your clock stopped, and the time was given back when you resumed.**
   ![Task 15 step 16](screenshots/student/task-15-step-16.png)
17. Type **What is the premium payback?** in **Your request**, replacing what is there. → You see: **28 of 2000 characters**.
   ![Task 15 step 17](screenshots/student/task-15-step-17.png)
18. Click **Ask the assistant**. → You see: **Reply complete. One claim surfaced.** and a card **Claim C3**.
   ![Task 15 step 18](screenshots/student/task-15-step-18.png)

*If something goes wrong:*

- "The run did not resume. Try it again." means the resume did not reach Tassl; the clock is still stopped. Press **Resume the run** again.
- "The run is paused, so the assistant is not answering. Resume the run and ask again." beside **Ask the assistant** means the run is still paused. Press **Resume the run** in the dialog.
- "The assistant did not answer, so the run is paused and the clock has stopped. Nothing you did was lost." is the sentence shown in the assistant panel a moment before the dialog opens; it means the same pause. Press **Resume the run**.

### Task 16: Manage notifications, your account, and sign out

*Goal:* Read your notifications, look through the three settings tabs, and sign out. Do this after Task 13.

*Steps:*

1. Click the **Notifications** bell in the header. → You see: the heading **Notifications**, **What Tassl has told you, newest first.**, and the entries **Your run has been scored** and **Your bands are confirmed**.
   ![Task 16 step 1](screenshots/student/task-16-step-01.png)
2. Click **Mark all read**. → You see: **Everything is marked read.**
   ![Task 16 step 2](screenshots/student/task-16-step-02.png)
3. Click the **Account** button in the header. → You see: a menu with your name, your email address, **Settings** and **Sign out**.
   ![Task 16 step 3](screenshots/student/task-16-step-03.png)
4. Click **Settings**. → You see: the heading **Account settings**, the tabs **Profile**, **Security** and **Data**, the field **Your name**, and **Email address** reading **student1@tassl.local** and not editable.
   ![Task 16 step 4](screenshots/student/task-16-step-04.png)
5. Click **Security**. → You see: **Password** with **Current password**, **New password** and **New password again**, and **Signed-in devices** with the badge **This device**.
   ![Task 16 step 5](screenshots/student/task-16-step-05.png)
6. Click **Data**. → You see: **Download my data** with **A JSON file holding your profile, your memberships, your runs, your notifications, and the actions you took. Twice an hour.**, and **Delete account**.
   ![Task 16 step 6](screenshots/student/task-16-step-06.png)
7. Click the button **Download my data**. → You see: **Your file is downloading.** and your browser saving tassl-my-data.json.
   ![Task 16 step 7](screenshots/student/task-16-step-07.png)
8. Click **Delete my account**. → You see: the dialog **Delete your account?** with the field **Type student1@tassl.local to confirm** and the buttons **Keep my account** and **Delete my account**.
   ![Task 16 step 8](screenshots/student/task-16-step-08.png)
9. Click **Keep my account**. → You see: the dialog gone and the **Data** tab unchanged.
   ![Task 16 step 9](screenshots/student/task-16-step-09.png)
10. Click the **Account** button, then **Sign out**. → You see: the heading **Sign in to Tassl**.
   ![Task 16 step 10](screenshots/student/task-16-step-10.png)

*If something goes wrong:*

- "You can download your data twice an hour. Try again shortly." means the second download inside half an hour was refused. Wait, then press **Download my data** again.
- "Type the email address of this account to confirm." means the address typed in the delete dialog is not this account's. The seeded seat is shared; press **Keep my account** and do not delete it.
- Landing on **Home** again after **Sign out** means the sign-out did not go through. Press **Account** and **Sign out** once more; if it happens again, clear the site's cookies in your browser.

## Working with the AI assistant

**What it is for.** The assistant is in the room from the moment you lock your frame until you file your decision, and again during the twelve-minute Turn window. Its panel says **Ask for anything inside this scenario. Claims the assistant raises arrive as their own cards, and every request is kept in the Delegation Log.** Each request you send is a delegation. A reply comes as prose, and every consequential statement in it arrives as a card headed **Claim C1** to **Claim C8**, quoting the claim word for word. On each card you take a stance: **Accept** means you rely on the claim as it stands; **Verify** means you rely on it after a meaningful check; **Challenge** means you have found a material problem or omission in it; **Reject** means you decline to use it; **Escalate** means it is beyond what you can settle yourself. A stance costs nothing, and you can change it while the run is open; the earlier one is kept beside the new one as **Changed from**.

**The Delegation Log.** Every request is listed as **Delegation 1**, **Delegation 2** and so on, with **You asked**, **The assistant answered** and **Claims in this reply**. Under each you can write one line in **Why you asked** (at most 200 characters, changeable while the run is open) and press **Save**. **Mark as used** records that you leaned on a claim; the log says **Marking a claim used records that you leaned on it. A mark stays on the record.** A claim counts as leaned on when you mark it used, when you type a figure it carries into one of **The figures you are betting on**, or when the Turn puts it in front of you. Filing the decision asks for a stance on every claim you leaned on; the dialog **A claim you leaned on has no stance** names the one at fault and offers **Go to the claim**. Your instructor reads the log beside the rest of the run.

**What it refuses.** The assistant answers only inside the scenario: a request about anything else gets a reply that says it finds nothing in the room that answers it. It never says which claim is planted, never names a defect or a failure family, never says what stance a claim deserves, never shows the answer key or the question bank, and never names a band. A request that asks it to do any of those things is answered without them. Nothing on any screen tells you which claim carries the defect before your run is scored; the debrief does, afterwards.

**When it is unavailable.** If a reply does not come back, the run pauses. A dialog **The run is paused** says **The assistant did not answer.** and **Your clock stopped when it happened, and the time this pause takes is given back to you when you resume. Nothing you have done is lost.** Its one button is **Resume the run**; until you press it the assistant panel reads **The run is paused, so the assistant is not answering. Resume the run and ask again.** and no document opens. The failed request stays in the log as **No answer came back. The run paused, your clock stopped, and the time was given back when you resumed.** After you resume, the next request answers as usual. If the installation's model budget is spent, the panel says **The assistant is unavailable: usage limit reached. Your clock stopped, and the run is paused.** and the same dialog follows.

**The scripted assistant.** An installation can run the assistant from a built-in fixture instead of a model provider; this is the demo's default and the setting a Platform admin sees on the Flags screen. Its replies are fixed: the same request always gets the same words, each claim is quoted verbatim, and the prose carries no figures of its own. The screens look identical, nothing on a Student screen says which is in use, and everything in this guide works the same way. With a live model, a figure the assistant states that is in no claim and no document you have opened is marked with a chip and the sentence **This figure is not in a claim or in a document you have opened. That says where it came from, not whether it is right.**

**What costs clock time.** Asking costs no clock time, and taking a stance costs none. **Check it** on a claim offers the checks the author wrote for it: **Source Trace** costs 1 minute, **Replication Check** 3 minutes and **Decomposition Check** 4 minutes of the working clock, charged when the check starts; **Read it again** reopens a finished check for nothing. The **Escalate** button under a claim opens **Escalate to a colleague**: one sentence of at least three words and at most 280 characters, 5 minutes of the working clock, two per run. Inside the Turn window the same checks and escalations cost window time instead. A request is at most 2000 characters, and more than ten requests in a minute are answered with **That is a lot of requests in a short time. Try again in {seconds} seconds.**

## Troubleshooting & FAQ

**The sign-in page says "Too many attempts. Try again in {seconds} seconds."** Ten attempts a minute are allowed from one address. Wait the seconds shown, then sign in again. Without a count the message reads "Too many attempts. Wait a minute and try again."

**The sign-in page says "That email address and password do not match an account."** The seeded seat is **student1@tassl.local**. Locally the password is **Walkthrough-Pass-2026**; in production it is the value of `SEED_PASSWORD`, which differs from the local one.

**You want to change the frame after locking it.** A locked frame is never edited, replaced or restored, not by you and not by your instructor; the panel **Your frame** reads **Locked** with the time and **This is what you locked. It is not edited again, and the rest of the run is read against it.** What you write now is the decision brief, which is read beside the frame.

**Filing the decision was refused with "A claim you leaned on has no stance".** You marked a claim used, typed one of its figures into a named field, or the Turn raised it, and it carries no stance. Press **Go to the claim**, choose one of the five stances, and press **Lock the decision** again. The claim is in the Delegation Log, under the request that raised it.

**The Turn window closed before you filed a response.** The band announced **The Turn window has closed.** and the page moved on. The decision you already filed stands, and the defense opens next; **What you filed** in the defense shows **The window closed without a response, so the decision you had already filed stands.** Nothing else changes.

**You were sent to the sign-in page in the middle of a run.** Your session ended: you signed out on another device, changed your password, pressed **Sign out every other device**, or the 30-day session expired. Sign in again; Tassl returns you to the page you were on. The run kept its place, and its clocks are server time, so nothing about it changed while you were out.

**The first page of the day takes a few seconds to open.** After more than five idle minutes the installation starts cold; the measured cold start is about two seconds against a warm response under a fifth of a second. Wait for the page; do not press **Start** or **Sign in** twice.

**The debrief still says Draft.** Every band is a draft until your instructor confirms it on the replay. The status page says **Your debrief is ready** with **The bands in it are drafts until your instructor confirms them**; when they confirm, the chip changes to **Confirmed**, the notification **Your bands are confirmed** arrives, and every card reads **Confirmed band**. Provisional points reach no gradebook.

**The Runs page says "This attempt was voided."** Your instructor voided that attempt; it is not scored and counts for nothing. If they re-offered the assignment, the row offers **Continue on attempt 2**; otherwise it reads **Your instructor will say whether it is re-offered.** The run's status page says **A voided attempt is not scored and counts for nothing.**

**The assistant panel says "That is a lot of requests in a short time. Try again in {seconds} seconds."** Ten requests a minute are answered. Wait the seconds shown; the working clock keeps running, and stances and reading cost nothing meanwhile.

**A dialog says "The run is paused".** The assistant did not answer, a document did not open, a check did not finish, or the connection dropped; the sentence under the title says which. Your clock stopped at that moment and the time the pause takes is given back. Press **Resume the run** and continue; nothing you did is lost.

**Run status says "Your run is under review by your instructor".** Scoring could not place every band from the trace alone, so a person reads the run before the bands are set. Nothing is asked of you; the debrief opens when your instructor confirms.

**The Readiness Check will not submit.** After a failure on Tassl's side the page offers **If the check will not submit** with **Skip the check**. Press **Submit the check** once more, then skip if it fails again; the check is not scored and never blocks the run. If the eight minutes run out, the check submits itself with the answers you had given.

## Glossary

- **Student** — the seat that takes a run; the product's word for you. **Instructor** reads your run and confirms its bands; a **Scenario author** builds scenario packages; a **Platform admin** runs the installation.
- **Decision Run** — one consequential business decision, taken with an AI assistant in the room and under a clock you cannot pause. One run is one row on **Runs**.
- **Scenario package** — the versioned unit an assignment is drawn from: the brief, the documents, the claims the assistant states, the Turn and the questions you answer afterwards. Your screens call it **the scenario**.
- **Variant** — one of two states of a package that differ only in which claim carries a defect: **Defective** carries one planted defect, **Sound** carries none. You learn which you drew only after scoring, in the debrief and on the Judgment Record.
- **Claim** — something the assistant states, shown as a card **Claim C1** to **Claim C8** with its text quoted verbatim.
- **Stance** — your position on a claim, taken before the outcome is known: **Accept**, **Verify**, **Challenge**, **Reject** or **Escalate**. Taking one costs nothing; an earlier stance is kept as **Changed from**.
- **Delegation Log** — the list of every request you sent, what came back, **Why you asked** and which claims you marked used.
- **Leaned on** — a claim you marked used, whose figure you typed into a named field, or which the Turn raised; filing asks for a stance on each.
- **Evidence Room** — the scenario's documents, all open to you in any order for as long as you like; Tassl records which you open and for how long and draws no conclusion from that.
- **Readiness Check** — sixteen items in eight minutes before the scenario opens; not scored, never blocking, closing with **What the check read**.
- **Frame** — **The decision** (50 words), three **Load-bearing assumptions** (25 each), **Your position now** (100) and a **Confidence** from 0 to 100, written before the assistant unlocks and locked permanently.
- **Working clock** — the run's clock, 25 minutes on the seeded scenario, starting when you lock the frame. Checks and escalations are charged against it; a pause stops it.
- **Check** — an action on a claim under **Check it**: **Source Trace** (1 minute), **Replication Check** (3 minutes) or **Decomposition Check** (4 minutes), returning what the author wrote. The debrief calls a check an interrogation action.
- **Escalation** — **Escalate to a colleague** on a claim: one sentence on what you cannot settle, answered inside the run, 5 minutes of clock, two per run.
- **Decision brief** — what you hand in: **Your recommendation** (120 words), **Why** (250), three assumptions (25 each), **What would change your mind** (60), **The figures you are betting on** and a **Confidence**. It saves as you type.
- **File the decision** — pressing **Lock the decision**, confirming **File this decision?** with **File it**, and reaching **Decision locked**. Irreversible: the brief, the frame, the log and the stances are frozen.
- **Addendum** — one note of up to 50 words beside the filed decision, added once between the lock and the Turn's end, never part of the decision.
- **The Turn** — one message from the world, arriving 90 seconds after the lock on the seeded scenario; the run reopens for the **Turn window** of 12 minutes and you file **Hold**, **Revise** or **Reverse** with **Why** (150 words) and a confidence.
- **The defense** — questions about your own run, answered with no assistant and no Evidence Room and no clock; an answer with no source, number or reason earns one **Follow-up**. Finishing it sends the run to scoring.
- **Trace** — the record of every event in the run, in order, with the clock as it stood; the graphs, the bands and the record are all drawn from it.
- **Band** — one of **Novice**, **Developing**, **Proficient** or **Professional** on each of the seven dimensions (**Framing**, **Delegation**, **Verification**, **Calibration**, **Decision Quality**, **Adaptation**, **Ownership**); **Unassessed** leaves a dimension out of the arithmetic. A **Draft band** becomes a **Confirmed band** when your instructor decides it.
- **Debrief** — **Run Debrief**, your run walked in order in twelve sections, with every band marked **Draft** until confirmed and **Two questions** that close the run.
- **Judgment Record** — the artifact you keep: the four graphs, the seven confirmed bands with notes, the mode and the variant, and **Download record**. It carries no weight, no mapping and no points.
- **Correction** — an instructor's act when Tassl got a claim wrong: the claim leaves the arithmetic and counts neither for you nor against you. A correction can raise a band and never lowers one; the debrief calls the claim **Corrected**.
- **Void** — an instructor ends an attempt that cannot be scored; it carries no partial result and reads **This attempt was voided.** on **Runs**.
- **Re-offer** — a new attempt on the same assignment after a void, shown as **Continue on attempt 2**.
- **Mapping** — **What a confirmed band is worth** in your course, by default Novice 1, Developing 2, Proficient 3, Professional 4.
- **Points** — the mean of the mapped values over the dimensions assessed, shown in the debrief as **Provisional points, draft** or **Confirmed points**. They go to your course's gradebook; Tassl holds no grade.
- **Declaration** — **Declare outside-tool use**: a note on what you used outside Tassl and what for. It never lowers a band or a point.
- **Walkthrough** — the chip on a practice assignment; a run on it can be deleted by the instructor instead of voided.

Verified by automated tests: 2026-09-09, commit 66d87fe
