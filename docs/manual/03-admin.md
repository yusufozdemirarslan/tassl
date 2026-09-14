# Platform administrator manual

This file is for the person who runs the Tassl installation itself: the account that holds the role
**Platform Admin**. After reading it you can find any account and set the one role it holds, read
what this deployment is running with, switch the assistant between the live model and the scripted
one, prove that error reporting works, read how much the deployment has spent with a model provider,
and answer "who changed this, and when" from the audit log. You will also know what this role
reaches beyond the admin area — every institution, with full access — and the few things that stay
out of reach even for you.

If you have not met the product before, read [what Tassl is](00-what-tassl-is.md) first.

---

## 1. Who you are in Tassl

Every account in Tassl holds exactly one role, and there are four:

| Role | What it lets the account do |
|---|---|
| **Platform Admin** | Everything: the admin area, and full access to every institution — its courses, rosters, assignments, runs, reviews and scenario packages — without belonging to it. |
| **Scenario Editor** | Everything a Student can do, plus building, editing and confirming the scenario packages of the institutions the person belongs to. |
| **Instructor** | Courses, sections, rosters, invitations and assignments; reading and deciding the runs of the courses they created or teach; reading scenario packages, but not building or confirming them. |
| **Student** | Taking the runs assigned to the sections they are on, and reading their own results. Every new account starts here. |

The role is set in one place, the **Users** screen in the admin area, and only a Platform Admin sets
it. Nothing else grants a role: an invitation makes a person a member of an institution, and a
section roster puts them on a section, but neither says what they may do there. The role says that,
the same in every institution they belong to.

You hold **Platform Admin**. In the seeded installation you belong to no institution, and you do not
need to: every institution on the platform is open to you, and the header names the one you are
working in.

### You can

- Open the admin area and its three screens: **Users**, **Flags** and **Audit log**.
- See every account on the platform, search it by the start of an email address, and see when each
  account joined.
- Set any other account's role to **Platform Admin**, **Scenario Editor**, **Instructor** or
  **Student**. Doing so signs that person out of every device at once and writes a row to the audit
  log.
- Open every institution's courses, sections, rosters and assignments, and do there everything an
  instructor can — including inviting people to the institution and adding them to a roster. See
  [the instructor manual](01-instructor.md).
- Open the review queue and the replay of any run, decide its bands, enter a correction, void it, and
  write and download its course export.
- Open every institution's scenario packages, build one from a seed case, edit its elements and
  confirm a version. See [the scenario editor manual](04-scenario-author.md).
- Hold an institution's settings and its data agreements, which are yours alone. Neither has a screen
  in this build.
- Read the deployment's flags, and the model provider the run loop would actually call right now.
- Switch **Assistant mode** between **Live model** and **Scripted assistant**. This is the only
  setting in the whole product that changes at once, without a redeploy.
- Send one test event to the error reporting service, to prove the connection from this deployment.
- Read how many model calls this deployment has made today and this month, how many tokens they
  used, and what they are estimated to have cost.
- Read the audit log for every institution on the platform, and filter it to one of them.
- Manage your own account: your name, your password, your signed-in devices, your data export and
  your account closure.

### You cannot

- Change your **own** role. Another Platform Admin has to do it.
- Edit a locked frame, a filed decision brief, a Turn response or a confirmed package version. Nobody
  can, on any screen; a change to a confirmed package means a new version.
- Read a run as its student does. When you open someone's run you read it the way an instructor
  does, through the replay, and opening it never uses up anything that belongs to the student.
- Change **FEATURE_AI**, **FEATURE_SAMPLE_DATA**, **FEATURE_TEST_CONTROLS** or **DEMO_MODE** from
  this screen or any other. Those four come from the deployment's environment; changing one is a
  deploy.
- Edit or delete anything in the audit log. Nothing there can be changed once it is written.
- See a composite score, a rank or a percentile. None exists anywhere in Tassl, for anyone.

### How this role sits beside the others

A course, a run, a roster and a scenario package all belong to an institution. Everyone else reaches
them by belonging to that institution, and a student or an instructor reaches a run only through a
section roster as well. You reach every institution without either, because the role is the whole of
your access.

That access is recorded, not hidden. Every consequential act you take inside an institution — a band
decided, a run voided, a correction entered, a package confirmed, a person added to a roster — is
written to the audit log with your account on it, exactly as it would be for an instructor or a
Scenario Editor.

The same rule runs the other way. If somebody who is not a Platform Admin types the address of any
admin screen, they get the in-shell **Not found** page: "There is nothing at this address. It may
have moved, or the link may be wrong.", with a **Go home** link. Hiding the **Admin** rail item from
them is only a courtesy; the refusal is made on the server, on every request, whether or not the
screen was ever drawn.

---

## 2. Signing in and your home screen

### Signing in

The sign-in screen, the sign-up screen, the password-reset screens and the confirmation screens are
the same for every role. They are described once, element by element, in
[the learner manual](02-learner.md).

In the demo installation you sign in as:

| Email | Name shown in the header |
|---|---|
| admin@tassl.local | Platform Admin |

The password is the one this installation was seeded with. Locally that is `Walkthrough-Pass-2026`.

### The home screen

Signing in lands you on **Home**.

![The platform admin home screen, showing every rail item and the Your runs, Review, Packages and Courses panels](screenshots/admin/home.png)

| Region | What it holds |
|---|---|
| The header bar | The **Tassl** wordmark on the left, which goes back to **Home**. Then the institution you are working in — **Walkthrough University** on the seeded installation; with more than one institution on the platform it opens a menu to switch between them. Then the notifications bell, whose accessible name is **Notifications: No unread notifications** while nothing is unread. Then the account button, whose accessible name is **Account: Platform Admin**. |
| The left rail | Every item there is: **Home**, **Runs**, **Courses**, **Review**, **Packages** and **Admin**. The rail's accessible name is **Primary**. |
| The page heading | **Home**, with the line "What needs your attention, and what is coming up." |
| **Your runs** | The runs assigned to you. You are on no roster, so it reads **Nothing to do yet**, with "When a course assigns you a run, it appears here with what to do next." |
| **Review** | The runs of the institution with bands waiting to be decided, and any run nothing could place, each with **Open the replay for** the student's name. |
| **Packages** | The package versions still being confirmed. On the seeded installation the one package is confirmed, so it reads **Nothing to confirm**. |
| **Courses** | The institution's courses, each with its count of sections and assignments. |

Home is built out of one panel per role, and it draws only the panels a role has data behind. A
student sees only **Your runs**; an instructor sees **Review** and **Courses**; a Scenario Editor sees
**Your runs** and **Packages**. You see all four, because your role reaches all four.

At a narrow window the same page stacks into one column and keeps everything: the header, the rail
items, the heading and the panels.

![The platform admin home screen at a narrow window width, with the same content stacked in one column](screenshots/admin/home-mobile.png)

---

## 3. Navigation map

```
Header
├── Tassl (wordmark)            → Home
├── Walkthrough University      (the institution you are working in)
├── Notifications (bell)        → Notifications
└── Account: Platform Admin     (menu)
    ├── Settings                → Account settings → Profile
    ├── Privacy                 → the privacy document
    ├── Terms                   → the terms document
    └── Sign out                → signs you out, lands on the sign-in screen

Primary (the left rail)
├── Home                        → Home
├── Runs                        → your own runs (the learner manual)
├── Courses                     → every course of the institution (the instructor manual)
├── Review                      → the review queue (the instructor manual)
├── Packages                    → the package shelf (the scenario editor manual)
└── Admin                       → the admin area, landing on Users
    │
    └── Admin sections (the strip under the page heading)
        ├── Users               → Users
        ├── Flags               → Flags
        └── Audit log           → Audit log

Account settings sections (the strip under the settings heading)
├── Profile                     → your name and email address
├── Security                    → password and signed-in devices
└── Data                        → download your data, delete your account
```

| Destination | How you get there | Address in the browser | What it is |
|---|---|---|---|
| **Home** | Rail item, or the **Tassl** wordmark | `/home` | Your own landing page |
| **Runs** | Rail item | `/runs` | The runs assigned to you; described in [the learner manual](02-learner.md) |
| **Courses** | Rail item | `/courses` | Every course of the institution, and everything under them; described in [the instructor manual](01-instructor.md) |
| **Review** | Rail item | `/review` | The runs with bands to decide; described in [the instructor manual](01-instructor.md) |
| **Packages** | Rail item | `/packages` | The scenario package shelf; described in [the scenario editor manual](04-scenario-author.md) |
| **Admin** | Rail item | `/admin/users` | The admin area; the rail item stays highlighted on all three of its screens |
| **Users** | **Admin**, then the **Users** tab | `/admin/users` | Every account on the platform, and the control that sets each account's role |
| **Flags** | **Admin**, then the **Flags** tab | `/admin/flags` | What this deployment is running with, the assistant switch, the error-reporting test and the model spend |
| **Audit log** | **Admin**, then the **Audit log** tab | `/admin/audit` | One row for each consequential act, on every institution |
| **Notifications** | The bell in the header | `/notifications` | What Tassl has told you |
| **Account settings** | Account menu, then **Settings** | `/settings` | Profile, Security and Data |
| **Security** | Account settings, then the **Security** tab | `/settings/security` | Password, and every device holding a live session |
| **Data** | Account settings, then the **Data** tab | `/settings/data` | Download your data; close your account |
| **Privacy** / **Terms** | Account menu | `/privacy`, `/terms` | The two legal documents |

The three admin tabs are real links, not a tab widget: each has its own address, each can be
bookmarked, and the back button moves between them. The same is true of the three settings tabs.

---

## 4. Dashboards

You read numbers off three places: your home screen, the flags screen read as a status board, and the
model-usage table.

### Home

Home carries the institution's own work, not the platform's: how many runs are waiting on a band
decision in **Review**, which package versions are still being confirmed in **Packages**, and how many
sections and assignments each course holds in **Courses**. Each panel links to the screen behind it,
and those screens are described in [the instructor manual](01-instructor.md) and
[the scenario editor manual](04-scenario-author.md).

### The flags screen as a status board

The whole of **Flags** is a status board. Nothing on it except **Assistant mode** is a control; it
is there to be read, and to be read quickly, because the questions it answers are the ones asked
five minutes before a class.

![The Flags screen showing the deployment flag table, the effective model provider, the assistant mode panel, the Sentry panel and the model usage table](screenshots/admin/admin-flags.png)

A deployment meant to run on the live model reads like this:

| What you read | Where on the screen | The healthy reading |
|---|---|---|
| **FEATURE_AI** | Row 1 of the flag table | **On** |
| **FEATURE_TEST_CONTROLS** | Row 3 of the flag table | **On**, if an instructor needs the armed-outage control during a class |
| **Effective model provider** | The panel under the table | `anthropic` on production, which runs on Claude Opus 5; `openai-compatible` on a deployment configured for MiMo; never `mock` |
| **Effective mode** | The line above the **Assistant mode** radios | **Live model** |
| **Estimated cost** and the month sentence | The **Model usage** table and the line under it | A share of the monthly budget well short of the whole |
| **Send a test event to Sentry** | The **Sentry** panel | Pressable, meaning an error-reporting address is configured |

A deployment running without a model key reads differently and is not broken: **FEATURE_AI** shows
**Off** and **Effective model provider** shows `mock`. The product is whole in that state. Every
screen behaves the same; the assistant's prose is written by the built-in fixture instead of a
model, and the students taking runs are never told that anything is different.

The screen captured above is exactly that case: **FEATURE_AI** is **Off**, the provider is `mock`,
and the provider panel carries the extra sentence "AI features are running in constrained mode:
every model call is answered by the built-in fixture provider, which is deterministic and costs
nothing." That sentence appears on this screen and nowhere else in Tassl. No student surface ever
says the assistant is degraded.

### The model-usage table

Three numbers, in two columns, and they are the deployment's real spend with a model provider.

| Row | What it counts |
|---|---|
| **Calls** | How many requests a model provider answered |
| **Tokens** | The input and output tokens of those calls, added together |
| **Estimated cost** | Those tokens priced at the model's list price: Claude Opus 5 at $5 per million input tokens and $25 per million output tokens; any other model at the rates this deployment is configured with |

| Column | The window it covers |
|---|---|
| **Today (UTC)** | From midnight UTC today. Not your local midnight — every time in Tassl is UTC |
| **This month** | From the first instant of this calendar month, UTC. Not a rolling thirty days |

A high monthly figure is only a problem against the budget, and the sentence under the table states
the budget in words, so the two can never disagree. A **Today (UTC)** figure of zero next to a large
monthly figure is normal: it means nothing has been asked of a model provider since midnight UTC,
not that anything has stopped. Section 5 explains every part of the table, including why calls the
built-in fixture answered are not in it.

### The audit log is a record, not a dashboard

The audit log counts nothing and totals nothing. It answers one question — what happened, when, to
what, by whom, in which request — and it answers it for every institution at once. Read it when you
need to establish a fact, not to watch a number.

---

## 5. Features

### The admin area

**What it is for.** Everything a platform administrator does lives here. It is three screens behind
one rail item.

**Where to find it.** The **Admin** item in the left rail. It is offered only to an account whose
role is **Platform Admin**, and pressing it takes you to **Users**.

![The admin area as it opens, on the Users screen, with the Users, Flags and Audit log tabs under the heading](screenshots/admin/admin-index.png)

Under the page heading sits a strip of three links, whose accessible name is **Admin sections**:

| Tab | What is on it |
|---|---|
| **Users** | Every account on the platform, and the control that sets each account's role |
| **Flags** | What this deployment runs with, the assistant switch, the error-reporting test, the model spend |
| **Audit log** | One row for each consequential act |

The tab you are on is marked as the current page, so a screen reader announces which of the three
you are reading.

**What happens to anyone else.** Every other account — a **Student**, a **Scenario Editor** and an
**Instructor** — gets the **Not found** page described in section 1, inside the app shell, on all
three addresses. They are not told that the admin area
exists and is refused to them. A visitor who is not signed in at all is sent to the sign-in screen
first, and returned to the address they asked for afterwards, where they then meet the same **Not
found** page unless they signed in as a platform admin.

There is no admin walkthrough guide. The two step-by-step guides cover what the other roles do:
[the student guide](../guides/learner-guide.md) and
[the instructor guide](../guides/instructor-guide.md). What the accounts you set go on to do is
described in [the learner manual](02-learner.md), [the instructor manual](01-instructor.md) and
[the scenario editor manual](04-scenario-author.md).

---

### Courses, review and packages

**What it is for.** Reaching inside any institution: to help an instructor, to settle a question about
a run, or to confirm a package when no Scenario Editor can.

**Where to find it.** The **Courses**, **Review** and **Packages** items in the left rail. They show
the institution named in the header.

Every screen behind them, and every control on those screens, works for you exactly as the other
manuals describe it: the courses, sections, rosters, invitations, assignments, exports and replays in
[the instructor manual](01-instructor.md), and the package shelf, generation and the confirmation
workspace in [the scenario editor manual](04-scenario-author.md). Two differences are worth knowing.

- **You need no membership.** You can open a roster, invite a person to the institution, decide a
  band or confirm a package version without belonging to the institution yourself. You are not on
  any roster, so you never appear in a section's **Members** list, and you are not sent the
  notifications addressed to a section's instructors or an institution's authors.
- **What you do is recorded as yours.** A band decision, a correction, a void, a package
  confirmation or a roster change you make carries your account in the audit log, exactly as the
  same act by an instructor or a Scenario Editor carries theirs.

---

### Users

**What it is for.** Seeing who has an account, and setting the one role each account holds.

**Where to find it.** **Admin** → **Users**.

![The Users screen, with the search box and a table of accounts showing Name, Email, one Platform role column and Joined](screenshots/admin/admin-users.png)

The heading is **Users** and the line under it states the rule the whole screen turns on: "Every
account on the platform, newest first. Each account holds one platform role: Platform Admin, Scenario
Editor, Instructor or Student. The role decides what that person can reach in every institution they
belong to."

#### The table

The caption reads **Accounts, newest first**. Twenty rows at a time, newest account first.

| Column | What the cell holds |
|---|---|
| **Name** | The name on the account. It is the row's heading, and it carries the row's chips. |
| **Email** | The address the account signs in with, in a monospace face so lookalike characters can be told apart. |
| **Platform role** | Either a dropdown holding the account's one role, or — on two kinds of row — the role as plain text with a note. |
| **Joined** | When the account was created, as `Sep 11, 2026, 10:23 PM UTC`. Every time in Tassl is UTC. |

Two chips can appear beside a name:

| Chip | When it appears |
|---|---|
| **Deleted** | The account has been closed. It is grey, not red: a closed account is a fact, not a fault. |
| **You** | The row is your own account. |

A closed account stays in the list. It shows the **Deleted** chip, its role as plain text, and no
control at all, with the note "A closed account holds no role, and is removed thirty days after it
closes." You cannot set a role on it; the thirty days is real, and after them the account row itself
is removed.

Your own row also shows its role as plain text and no control, with the note "Your own role is set
by another admin." This is not a display quirk. Changing your own role would sign you out of the only
role that could change it back, so Tassl refuses the act and does not draw the control that would
attempt it.

#### The search

| Element | What it does |
|---|---|
| **Search by email address** | The box. Its placeholder reads "Start of an email address". |
| **Search** | Runs the search. |
| **Clear** | Goes back to the whole list. It appears only when the box has something in it. |

The match is on the **start** of the email address and nothing else. It ignores capitals, and a
`%` or an `_` typed into the box is matched as the character itself rather than as a wildcard. It
does not search names, and it does not match the middle of an address — which is exactly what the
capture below shows: a search for `tassl.local` finds nothing, because no address *starts* with it.

![The Users screen after a search that matched nothing, showing the Clear link and the heading No address starts with that](screenshots/admin/admin-users-searched.png)

The empty result reads "No address starts with that", with "The search matches the start of an
email address. Clear it to see every account."

The search text stays in the address bar, so a filtered list can be bookmarked, reloaded and backed
out of like any other page. **Show more accounts**, at the foot of the table, adds the next twenty
rows and keeps the search you are in.

#### What each role lets someone do

An account holds exactly one role, and it applies in every institution the account belongs to.
There are four, and the dropdown lists them most access first.

| Role | What it lets the account do |
|---|---|
| **Platform Admin** | The admin area and everything in this manual — every account's role, the flags screen and its one switch, the error-reporting test event, the audit log — and full access to every institution without belonging to it. |
| **Scenario Editor** | Everything a Student can do, plus the **Packages** rail item: build a package from a seed case, import one, run generation, edit and reject elements, read the seed record, and confirm the version assignments run on. It reaches no course, roster or review screen. |
| **Instructor** | The **Courses**, **Review** and **Packages** rail items: create courses and sections, fill rosters, invite people to the institution, set assignments, and read and decide the runs of the courses they created or teach. Packages are read, never built or confirmed. An instructor does not take runs. |
| **Student** | The **Runs** rail item: take the runs assigned to the sections they are on, and read their own debrief and Judgment Record. This is what every new account gets. |

Two consequences are worth knowing before you change anything.

- **The role decides; memberships and rosters only place.** Which institutions a person belongs to
  comes from invitations, and which sections they are on comes from rosters. Changing the role moves
  nobody in or out of either — but it changes what those places mean. A roster row that enrolled a
  **Student** in a section makes the same person, as an **Instructor**, a teacher of that course, able
  to read every run in it.
- **Confirming a package belongs to the Scenario Editor.** Make somebody an **Instructor** and they
  read packages to set assignments on them; make them a **Scenario Editor** and they build and confirm
  them. A Platform Admin can do both.

![The Users screen with a Platform role dropdown open, showing the four options Platform Admin, Scenario Editor, Instructor and Student](screenshots/admin/admin-platform-role-options.png)

#### Changing someone's role

1. Find the account. Type the start of its email address into **Search by email address** and press
   **Search**, or press **Show more accounts** until the row appears.
2. Open the dropdown in that row's **Platform role** cell. Its accessible name is "Platform role
   for" followed by the account's name, so a screen reader says whose role is being changed. The
   four options are listed most access first: **Platform Admin**, **Scenario Editor**,
   **Instructor**, **Student**.
3. Choose the new role. **Nothing is saved yet.** A dialog opens, titled "Change this platform
   role?", saying: the person "goes from" their current role "to" the chosen role "on the platform.
   This signs them out of every device straight away, and the change is written to the audit log
   with your name on it."
4. Press "Change the role" to make the change, or "Leave it as it is" to abandon it. While the
   change is saving, the dialog cannot be dismissed.

**What happens after.** The row updates where it stands — you keep your place in the list — and a
message confirms it: the person "is now" the new role "on the platform, and is signed out
everywhere."

Three things happen together, or not at all:

| What changes | Detail |
|---|---|
| The role | Set to the value you chose. The old one is gone: an account never holds two. |
| Every session that account holds | Deleted. They are signed out of every device immediately, not at the end of a session or after a cache expires. |
| The audit log | One new row, recording the change from the old role to the new one, and how many sessions were ended. |

**What the person on the other end sees.** Their next action finds them signed out, and they are
sent to the sign-in screen. Nothing tells them why, and nothing tells them who did it. When they
sign in again, the rail and the home screen are the new role's:

| Role | Rail items |
|---|---|
| **Student** | **Home**, **Runs** |
| **Scenario Editor** | **Home**, **Runs**, **Packages** |
| **Instructor** | **Home**, **Courses**, **Review**, **Packages** |
| **Platform Admin** | **Home**, **Runs**, **Courses**, **Review**, **Packages**, **Admin** |

**What does not change.** Their institution memberships, their section rosters, their runs and the
courses they created are untouched. A role change moves no one in or out of a class.

**What other roles see change.** On every section roster the person is on, the **Role** column now
reads the new role. Nothing else on any course, run or review screen moves.

---

### Flags

**What it is for.** Answering "what is this deployment actually running with?" in one screen.

**Where to find it.** **Admin** → **Flags**.

The heading is **Flags**, and the line under it states the whole screen's terms: "What this
deployment is running with. The flags come from the environment, so changing one of them is a deploy
and not a switch on this screen. The assistant mode below is the one setting that is a switch."

#### The flag table

![The deployment flag table on the Flags screen, with four rows and the columns Flag, Value, Source and What it does](screenshots/admin/admin-flags-table.png)

The caption reads **The deployment flags, and what each one changes**. Four columns — **Flag**,
**Value**, **Source**, **What it does** — and four rows. The **Value** cell is a badge reading
**On** or **Off**. The **Source** cell is the word **Environment** on every row, without exception.

| Flag | What it changes when it is **On** | What it changes when it is **Off** |
|---|---|---|
| **FEATURE_AI** | Model calls may go to the configured provider, subject to the assistant mode below and the token budgets. | The built-in fixture answers every model call, everywhere, whatever the deployment's configured provider says. The on-screen wording is: "Off forces the built-in fixture model everywhere, whatever LLM_PROVIDER says. The product is whole either way." |
| **FEATURE_SAMPLE_DATA** | The illustrative sample panels are shown, each carrying its own label "so nobody reads one as a real run". | Those panels are absent. |
| **FEATURE_TEST_CONTROLS** | An instructor can arm a single assistant outage inside a student's live run, for the walkthrough. "Every use is written to the audit log." | The control is refused. An instructor who presses it is told "Test controls are switched off in this environment, so nothing was armed." |
| **DEMO_MODE** | "On, a new sign-up is confirmed and signed in at once, every email goes to the log rather than to a person, and the seeded accounts are the demo logins." | Sign-up sends a confirmation email and the address must be confirmed before the person can sign in; email is delivered for real. |

#### "From the environment" — what that means for you

These four values are set where the application is deployed, not in the application. There is no
control on this screen, and there is none on any other. To change one of them, somebody with access
to the hosting environment changes the value there and redeploys the app; the new value is what this
table shows afterwards.

Practically: **changing a flag is a deploy, and it takes minutes.** If you need the assistant off
*now*, do not go looking for a flag — use **Assistant mode** below, which takes effect on the next
request with no deploy at all.

#### Effective model provider

![The Effective model provider panel, showing the value mock and the sentence explaining that no run text reaches a model provider](screenshots/admin/admin-flags-provider.png)

The panel **Effective model provider** answers a question the flag table alone cannot: "The provider
the run loop would actually call right now, which is the mock whenever FEATURE_AI is off." The value
under it is one word, in a monospace face:

| Value | What it means |
|---|---|
| `mock` | The built-in fixture answers. The panel adds: "This deployment answers the assistant from a fixture: no run text reaches a model provider." |
| `anthropic` | The Claude model this deployment is configured with answers: `claude-opus-5` on production. This is the normal reading for production. |
| `openai-compatible` | The MiMo model this deployment is configured with answers. A supported network provider, and the one production ran on before Claude. |

One more sentence appears here, and only when **FEATURE_AI** is **Off**: "AI features are running in
constrained mode: every model call is answered by the built-in fixture provider, which is
deterministic and costs nothing." The two sentences answer different questions on purpose — the
first follows the provider, the second follows the flag — so a deployment configured for the fixture
while the flag is on shows the first and not the second.

---

### Assistant mode

**What it is for.** Changing which assistant answers students, right now, without a deploy. It is
the one control on the flags screen and the only runtime setting in the product.

**Where to find it.** **Admin** → **Flags** → the **Assistant mode** panel.

The panel's description states its own terms: "Which assistant answers the next request. Saving
takes effect on the next model call, with no redeploy. FEATURE_AI=false overrides it: with the flag
off, the assistant is scripted whatever is chosen here."

#### The two modes

| Option | Hint under it | What it does |
|---|---|---|
| **Live model** | "Requests go to the configured model provider, within the token budgets." | Every assistant request goes to the network model this deployment is configured with, and is counted in **Model usage**. |
| **Scripted assistant** | "Requests are answered by the built-in fixture: deterministic, free, and no run text leaves Tassl." | Every assistant request is answered by the built-in fixture. The same request always gets the same reply, nothing is billed, and no text a student wrote leaves the deployment. |

#### The Effective mode line, and why you trust it over the radios

Above the two options is a line reading **Effective mode:** followed by **Live model** or **Scripted
assistant**. Read this line, not the radio buttons, to know what students are getting.

The two can disagree, and when they do the line is right. The radios say what this switch is asking
for; the line says what the deployment will actually do, because it is worked out from the
**Effective model provider** first and this switch only afterwards. So a deployment whose effective
provider is `mock` reads **Effective mode: Scripted assistant** however the radios are set, and no
save will change that.

The capture below is exactly that disagreement. **FEATURE_AI** is **On**, so the switch is live and
pressable and **Live model** is the chosen radio — but this deployment's configured provider is the
fixture, so **Effective model provider** reads `mock` and the line above the radios reads **Effective
mode: Scripted assistant**. Nothing is wrong with the screen. The line is telling you the truth the
radios cannot.

![The Assistant mode panel with the switch enabled, showing the Effective mode line reading Scripted assistant above the selected Live model option, the Scripted assistant option, and an active Save assistant mode button](screenshots/admin/admin-flags-assistant-mode-enabled.png)

The same wording appears in three places and they cannot disagree, because all three read the same
answer: this line, the deployment's own health check that an operator polls, and the chip in the
**AI assistant** panel header that a student sees inside a run, which also reads **Live model** or
**Scripted assistant**.

#### Using it

1. Go to **Admin** → **Flags** and find the **Assistant mode** panel.
2. Choose **Live model** or **Scripted assistant**.
3. Press **Save assistant mode**. While it saves, the button reads "Saving".
4. A message confirms it: "Assistant mode saved." The line above the radios updates.

**When it takes effect.** On the next model call. There is no cache, no restart and no redeploy. A
student in the middle of a run gets the new assistant on their next request to it; nothing about
their run changes, and they are not told. Every save writes a row to the audit log recording what
the mode was and what it became.

This is the fastest way to take a misbehaving or expensive model out of the path, and
[the demo runbook](../guides/demo-runbook.md) treats it as the first line of recovery: under a
minute, against about four minutes for a change to the environment and a redeploy.

#### When the switch is disabled

If **FEATURE_AI** is **Off**, there is nothing for this switch to change: the fixture is already
answering everything, unconditionally. So the two options and the **Save assistant mode** button are
disabled, and a sentence appears beside the button: "FEATURE_AI is off in this environment, so the
assistant is scripted whatever is chosen here. Turn the flag on and redeploy to make this switch
live." This is the state the seeded installation starts in.

![The Assistant mode panel with FEATURE_AI off: both options and the Save assistant mode button greyed out, and the sentence saying the assistant is scripted whatever is chosen here](screenshots/admin/admin-flags-assistant-mode.png)

The button is disabled in a way that keeps it reachable by keyboard, so a screen reader reads the
reason along with it rather than skipping past a dead control. If a save is somehow attempted in
this state it is refused with: "FEATURE_AI is off in this environment, so the assistant is already
scripted and this switch cannot change it."

The order of precedence is fixed, and it only ever narrows: the environment's flag beats this
switch, and this switch beats the deployment's configured provider. You can always switch a
deployment off a live model; you can never switch a deployment that has no model onto one.

---

### Model usage

**What it is for.** Seeing what this deployment has spent with a model provider, against the budgets
that will refuse a call when they are reached.

**Where to find it.** **Admin** → **Flags** → the **Model usage** panel, at the foot of the screen.

![The Model usage table, showing Calls, Tokens and Estimated cost for today and this month, with the two budget sentences below it](screenshots/admin/admin-flags-model-usage.png)

The panel's description says what the numbers are: "What this deployment has spent with a model
provider. These are the sums the budget guard reads before every call, so a call refused for being
over budget is refused against exactly these numbers. Calls the built-in fixture provider answered
are not counted: nobody was billed for them."

The table's caption reads **Model calls, tokens and estimated cost, today and this month**. Three
columns — **Measure**, **Today (UTC)**, **This month** — and three rows.

| Row | What it is |
|---|---|
| **Calls** | How many requests a model provider answered in the window. |
| **Tokens** | The input and output tokens of those calls, added together. |
| **Estimated cost** | Those tokens priced at the model's list price — Claude Opus 5 at $5 per million input tokens and $25 per million output tokens, thinking included in the output — or, for a model Tassl has no price for, at the rates this deployment is configured with; printed as dollars to two to four decimal places. It is an estimate, and it is labeled as one; the provider's own invoice is the authority. |

**Today (UTC)** starts at midnight UTC — not at your local midnight. **This month** starts at the
first instant of this calendar month in UTC, and it resets when the month turns; it is not a rolling
thirty days.

The sentences under the table state the budgets in words. In the capture they read:

> "The month has used 1,726,559 of the 20,000,000 tokens in LLM_GLOBAL_MONTHLY_TOKEN_BUDGET, which
> is 8.6%. Past it, every model call is refused until the calendar month turns."

> "LLM_USER_DAILY_TOKEN_BUDGET is 200,000 tokens per person per UTC day. It is counted per person,
> so the platform-wide figure above is not measured against it."

The screen now carries a third sentence between those two, the dollar ceiling, with the month's
estimated cost and the budget in dollars where the dots are:

> "The month’s estimated cost is … of the … in LLM_GLOBAL_MONTHLY_USD_BUDGET. Past it, every model
> call is refused until the calendar month turns."

It exists because a token is not a fixed price: at Claude Opus 5's rates the 20,000,000-token
ceiling alone would allow a month of anywhere from $100 (all input) to $500 (all output). Whichever of the two monthly ceilings is reached
first refuses the call.

The first names the platform's monthly token ceiling and what share of it has gone. The second names the
per-person daily ceiling and warns you not to compare it against the table: the daily budget is
counted against each person separately, so the platform total above says nothing about whether any
individual is near their own limit.

**What you read these numbers for.**

- Before a class or a demo: is the month's share small enough that the session will not hit the
  ceiling partway through?
- After a change: did the switch to **Scripted assistant** actually stop the spend? **Today (UTC)**
  stops rising if it did.
- When a student reports the assistant is unavailable: if the month's share has reached the whole,
  the refusal is a spent budget rather than a broken provider, and the student's screen will have
  said "The assistant is unavailable: usage limit reached. Your clock stopped, and the run is
  paused."

**Why fixture-answered calls are not counted.** Nothing was billed for them. Counting them would
make the table say a deployment is spending money it is not, and it would make the number disagree
with the guard that refuses calls — which reads exactly these sums. A deployment running entirely on
the fixture shows zeroes here, and the zero is the truth. It follows that a monthly figure can stay
put while students keep using the assistant, if the assistant they are using is the scripted one:
the capture above shows a month with 586 real calls on it and nothing today, on a deployment now
answering from the fixture.

This panel is the only place in Tassl where budget consumption can be read without a separate
analytics account.

---

### Sentry

**What it is for.** Proving, from inside this deployment, that an error raised here reaches the
error-reporting service — the last hop that nothing else tests.

**Where to find it.** **Admin** → **Flags** → the **Sentry** panel.

![The Sentry panel, with its description, the sentence explaining that no reporting address is configured, and the disabled Send a test event to Sentry button](screenshots/admin/admin-flags-sentry.png)

The description reads: "Sends one test event from this deployment, tagged ops:sentry_test, so the
last hop to Sentry is proven from where the real events start. It lands in the issue the launch
checklist already knows."

**How to use it.** Press **Send a test event to Sentry**. While it is in flight the button reads
"Sending…". When it returns, a line and a message report it: "Test event", then the event's
identifier, then "sent to Sentry", then the name of the deployment it came from in brackets — for
example `production`.

**What it proves.** That a real error raised by this deployment, on this day, with this
configuration, would arrive. Every earlier link in the chain can be tested from a developer's
machine; this one cannot, because the thing being tested is the network path out of the running
deployment. Quote the event identifier to whoever is watching the error dashboard and they can
confirm the far end.

**What it sends.** One event carrying a fixed message, a fixed tag and the deployment's name. No
personal data, no run text, no account identifier. It is given the same tag and fingerprint every
time, so every test event collects into one issue rather than filling the dashboard with new ones.

**When it is disabled.** When this deployment has no error-reporting address configured. The button
is then unpressable and a sentence sits above it: "NEXT_PUBLIC_SENTRY_DSN is empty in this
deployment, so the SDK is off and nothing leaves it. The button does nothing until a DSN is set and
the app redeployed." As with the assistant switch, the button stays reachable by keyboard so the
reason is read with it. Setting that address is an environment change and a deploy, the same as a
flag.

---

### Audit log

**What it is for.** Answering "who changed this, and when" — for every institution on the platform,
from one screen.

**Where to find it.** **Admin** → **Audit log**.

![The Audit log screen, with the institution filter and a table of rows showing Time, Action, Target, Actor, Institution, Request and Record](screenshots/admin/admin-audit.png)

The heading is **Audit log** and the line under it is the promise the screen keeps: "One row for
each consequential act, newest first, with the request it belonged to. Rows are append-only:
nothing here can be edited or removed."

#### The columns

The caption reads **Audit rows, newest first**. Twenty rows at a time.

| Column | What the cell holds |
|---|---|
| **Time** | When the act happened, as `Sep 11, 2026, 10:21 PM UTC`. The row's heading, in a monospace face with aligned digits so a column of times can be scanned. |
| **Action** | What was done, as a short code — `band.decide`, `role.set`, `export.write`, `section_member.add`, and so on. The table below lists every one. |
| **Target** | What it was done to: the kind of thing, then its identifier — for example `run` followed by the run's id. |
| **Actor** | The account that did it, by identifier. When nothing was acting — a scheduled job, a script, the seed — the cell reads **System** instead. |
| **Institution** | The institution the act belonged to, by identifier. When the act belonged to the platform rather than to any institution — a role change, an assistant-mode save — the cell reads **Platform**. |
| **Request** | The request the act belonged to, as an identifier. Acts done by a background job carry `job:` and the job's id; acts done by a script or by the seed carry the word `system`. |
| **Record** | A collapsed disclosure reading **Open the record**. Opening it shows what was recorded alongside the act. When nothing was recorded, the cell reads "No record" and there is nothing to open. |

**Identifiers are shown as identifiers, deliberately.** An audit row is read beside a server log
line, and resolving an identifier to a name here would be a second lookup that could disagree with
what the row actually recorded. It follows that these screens will not turn an **Actor** identifier
into a person for you: the **Users** table lists names and addresses, not identifiers. What the log
does give you is the **Request** column, which ties every row written by the same request together,
and the **Record**, which carries the specifics of the change.

#### The institution filter

![The Audit log screen with the Institution dropdown open, showing Every institution and Walkthrough University](screenshots/admin/admin-audit-institution-filter.png)

| Element | What it does |
|---|---|
| **Institution** | A dropdown. The first option is **Every institution**, which is where the screen starts. Under it, every institution on the platform by name, A to Z. |
| **Apply** | Applies the choice. |

1. Open the **Institution** dropdown.
2. Choose an institution, or **Every institution** to go back to the whole log.
3. Press **Apply**.

The choice lands in the address bar, so a filtered log can be bookmarked and reloaded. The list
offers every institution on the platform, not just ones you belong to — you belong to none. It is
capped at two hundred names; on a deployment with more than that, a line appears under the dropdown
reading "The first 200 institutions by name. A deployment with more than that has institutions this
filter does not offer."

**Show more rows**, at the foot of the table, adds the next twenty rows and keeps the institution
you filtered to.

If the institution you picked has nothing audited, the screen says so — "Nothing audited for that
institution", with "Nothing has been audited for the institution this filter names. The whole log
may still have rows in it." — and offers a "Show every institution" action back to the unfiltered
log. On a platform where nothing at all has been audited yet, the screen reads "Nothing audited yet"
with "A role change, a band decision, an export or a deletion writes the first row here."

#### What is recorded

Every row is written in the same transaction as the change it records, so a change that happened has
a row and a change that was rolled back has none.

| **Action** | Written when | What the record carries |
|---|---|---|
| `role.set` | An account's role is changed | The role it was, the role it became, and how many sessions were ended |
| `ai_mode.set` | The assistant mode is saved | The mode it was and the mode it became |
| `band.decide` | A band is confirmed, overridden or set unassessed | The dimension, the decision, the band, whether a note was written, and whether it differed from the draft |
| `run.void` | A run is voided | The reason, the state the run was in, and whether a replacement was offered |
| `run.reoffer` | A replacement run is issued | Which run it replaces, and which variant it uses |
| `claim.neutralize` | A correction is entered on a claim | The claim, the reason, whether the student's challenge was credited, the dimensions affected |
| `export.write` | A course export is filed | The version number and why it was written |
| `account.delete` | Somebody closes their own account | How many days until it is purged |
| `agreement.upsert` | A data agreement is created or changed | Its purposes, roles, retention and end date |
| `package.confirm` | A scenario package version is confirmed | The package, the version and how many elements it holds |
| `package.regenerate` | A version is regenerated into a new one | Which version it came from, the new version, and the reason |
| `mapping.change` | A course changes its band-to-points mapping | The old and new mapping, and how many runs were affected |
| `test_control.force_failure` | An assistant outage is armed inside a run | That it was armed |
| `invitation.create` | Somebody is invited to an institution | Nothing beyond the row: an invitation carries no role, and the address is never recorded |
| `section_member.add` | Somebody is added to a section roster | The section and the account |
| `run.delete` | A walkthrough run is deleted | The assignment, the section, the attempt number and the run's state |

#### What is not recorded

The audit log is a record of consequential acts, not a surveillance trail. It does not carry:

- Sign-ins, sign-outs, page views or any read. Opening a screen writes nothing.
- Anything a student typed: no frame, no brief, no request to the assistant, no reply, no defense
  answer. Those live with the run, and are read in its replay.
- The note an instructor wrote on a band. The record says a note exists, never what it says.
- The email address an invitation was sent to.
- Any secret, key or password.

#### Using it to answer "who changed this"

1. Go to **Admin** → **Audit log**.
2. If you know which institution the thing belongs to, choose it in **Institution** and press
   **Apply**. Platform acts — role changes, assistant-mode saves — are not in any institution; leave
   the filter on **Every institution** for those, and look for **Platform** in the institution
   column.
3. Scan the **Action** column for the kind of act — `band.decide` for a band, `mapping.change` for a
   course's arithmetic, `role.set` for a role change, `run.void` for a voided run.
4. Match the **Target** against the identifier of the thing you are asking about.
5. Press **Open the record** on that row to see exactly what changed.
6. Note the **Time**, the **Actor** and the **Request**. The request identifier is what ties this row
   to every other row of the same request and to the server's own log of it, and it is the reference
   to quote to whoever is investigating.
7. Press **Show more rows** if the act is older than the rows on screen.

#### Editing and removing

Neither is possible, for anybody, including you. There is no edit control, no delete control, and no
process behind the screen that removes a row. Rows outlive the accounts they name: when somebody
closes their account and it is purged, the audit rows they wrote stay, carrying the identifier they
had.

---

## 6. The AI assistant

**You do not work with the assistant yourself.** It exists inside a Decision Run, and it answers
only the student whose run it is. When you open a run it is through the replay, the way an
instructor reads it, and the replay holds no assistant panel to type into.

What you hold is everything around it.

**What you control.**

| Control | Where | Effect |
|---|---|---|
| **Assistant mode** | **Admin** → **Flags** | Switches every student on this deployment between the live model and the scripted assistant, on the next request. See section 5. |
| **FEATURE_AI** | The deployment's environment; you read it on **Flags** | When **Off**, the scripted assistant answers everything and the switch above is disabled. Changing it is a deploy. |

**What you can see of its use.**

| What you see | Where |
|---|---|
| How many calls a model provider answered, their tokens, and the estimated cost | The **Model usage** table |
| Which assistant is answering right now | **Effective mode** on the **Flags** screen |
| Which provider the run loop would call | **Effective model provider** |
| That an assistant outage was armed inside a run, and by which account | The `test_control.force_failure` rows in the audit log |
| That the assistant mode was changed, from what to what, by which account | The `ai_mode.set` rows in the audit log |

**Where a student's words are, and where they are not.** Any request a student made, any reply that
came back, which claims were raised and anything a student wrote live with the run, and you read
them in its replay, as an instructor does — see [the instructor manual](01-instructor.md). None of it
is in the audit log or in the model-usage table, by design: what is kept per call is the shape of the
call, never its text.

**What the assistant does and refuses** is described for the person who meets it in
[the learner manual](02-learner.md). Two of its rules matter to you as an operator:

- It never says whether a claim is sound or defective, ranks claims by reliability, or mentions
  scoring, bands or grades. This is enforced, not merely requested.
- **A scripted assistant is not a degraded product.** The scripted assistant answers with the same
  claim cards, the same panel and the same behavior; only the connective prose differs, and it is
  deterministic and free. The only place in Tassl that says a deployment is running constrained is
  the **Effective model provider** panel on your own **Flags** screen. No student is ever shown a
  banner saying the assistant is degraded, and you should not add one by telling a class.

---

## 7. Notifications, settings, and account

### The bell and the notifications screen

The bell sits in the header on every signed-in screen. Its accessible name states the count —
**Notifications: No unread notifications** when nothing is unread, and the number when there is. The
count re-checks itself about once a minute while the tab is in front, and immediately when you come
back to the tab.

![The Notifications screen for a platform admin, showing the empty state Nothing yet](screenshots/admin/notifications.png)

The screen is headed **Notifications**, with "What Tassl has told you, newest first." Yours is
normally empty, and reads "Nothing yet": "Tassl writes here when a run is scored, a package finishes
generating, or an instructor confirms your bands."

That is not a fault. Every notification Tassl writes is addressed to the people of a run, a section
or an institution, and a Platform Admin is none of them: you are on no roster and a member of no
institution. There are eight kinds. Each kind's name is read out by a
screen reader before the row's title rather than printed on the screen, so the names below are what
you hear, not what you see:

| Kind | Written when | Who receives it |
|---|---|---|
| **Package generated** | Every generation step on a package version finishes | The author of that package |
| **Generation stopped** | A generation step fails the scenario rules a second time and stops | The author of that package |
| **Run scored** | Tassl has drafted a run's bands | The student who took the run, and the instructors of the section: those on its roster and the course's creator |
| **Run held for review** | Nothing could place a run's bands | The instructors of the section; never the student |
| **Bands confirmed** | A run's bands are confirmed for the first time | The student of that run |
| **Invitation** | Never. The kind exists but nothing in Tassl writes one | Nobody; an invitation arrives by email instead |
| **Export ready** | A course export is filed for a run | The instructors of the section |
| **Package confirmed** | A package version is confirmed and frozen | Every Instructor and Scenario Editor of the institution, except the person who confirmed it |

If your list ever does fill, it is because your account was a member of an institution before it
became a Platform Admin.

Where there are notifications, each row shows its title, its body and its time; an unread row is bold
with a colored rule down its left edge and the word **Unread** for a screen reader. **Mark read**
clears one row, **Mark all read** clears every one and confirms with "Everything is marked read.",
**Open** goes to the thing the row is about when it names one, and **Show more notifications** at the
foot of the list fetches the next twenty. No notification ever carries a band, a count, a rate or
anything a student wrote — they are also delivered by email, and email is not a safe place for any of
that.

### Account settings

Reach them from the account menu in the header, then **Settings**. There is no rail item. All three
screens are headed **Account settings**, with "Your profile, your password and devices, and your
data.", and a strip of three links whose accessible name is **Account settings sections**.

#### Profile

![The Profile tab of Account settings, with an editable name field and a disabled email address field](screenshots/admin/settings.png)

| Element | What it does |
|---|---|
| **Profile** | The panel, with "The name your instructors and classmates see beside your work." |
| **Your name** | Editable. It must not be empty and must be 120 characters or fewer. |
| **Email address** | Shown, and not editable. The note under it reads "Your institution knows you by this address, so it is not editable here. Ask your instructor if it needs to change." |
| **Save changes** | Saves the name, and confirms with "Your name is saved." |

There is no way to change an email address anywhere in Tassl, for any role, including this one.

#### Security

![The Security tab of Account settings, showing the Password panel and the Signed-in devices panel](screenshots/admin/settings-security.png)

| Panel | Elements |
|---|---|
| **Password** | "Choosing a new password signs out every other device straight away." Three fields — **Current password**, **New password**, **New password again** — and **Change password**. A password is 12 to 128 characters, with no composition rules. Success reads "Your password is changed. Other devices are signed out." |
| **Signed-in devices** | "Every device holding a live session. Sign out any you do not recognise." One row per session, showing the browser and platform — for example **Chrome on Windows** — and under it the address it signed in from and when. The row you are reading on is marked **This device** and has no sign-out button; signing this one out is the account menu's job. |

Every other row carries a **Sign out** button that ends that one session, and under the list sits
**Sign out every other device**, which ends all of them at once and leaves only the one you are
reading on. Neither appears when there is nothing else to end: the panel then reads **No other device
is signed in.** instead, which is what the capture above shows.

This panel is worth a habit for an operator account: an administrator's session is the one on the
platform that is worth the most to somebody else, and this is where you end one you did not
recognize.

#### Data

![The Data tab of Account settings, showing the Download my data panel and the Delete account panel](screenshots/admin/settings-data.png)

| Panel | What it does |
|---|---|
| **Download my data** | "A JSON file holding your profile, your memberships, your runs, your notifications, and the actions you took. Twice an hour." Press **Download my data**. For this account the file carries your profile and role, an empty membership list, your notifications, and the audit rows where you were the actor — including every role you changed. The twice-an-hour limit is counted per account. |
| **Delete account** | "Your account closes immediately and is deleted 30 days later. Course records keep a pseudonymous copy of your runs so your institution can keep its grades; that copy carries no name and no email address." Press **Delete my account**, which opens a dialog. |

The dialog is titled "Delete your account?" and says: "You are signed out straight away and cannot
sign in again. After 30 days everything Tassl holds about you is deleted; the pseudonymous course
record of your runs stays with your institution." Under that sits a field labeled "Type" followed by
this account's own email address "to confirm"; the second **Delete my account** button stays
unpressable until you type that address exactly. **Keep my account** closes the dialog and changes
nothing.

**Before you close a platform admin account, read this.** The act is immediate and cannot be undone.
Your session ends, you cannot sign in again, and after thirty days the account is removed. Your rows
in the audit log stay, because the log outlives the accounts it names. Crucially, nobody can change
their *own* role — so if this is the last **Platform Admin** on the deployment, closing it leaves the
platform with no one who can promote a replacement. Make somebody else a **Platform Admin** first.

### The account menu and signing out

![The account menu open on the home screen, showing the account name and address and the items Settings, Privacy, Terms and Sign out](screenshots/admin/account-menu.png)

The trigger is the person icon in the header; its accessible name is **Account: Platform Admin**.
The menu shows your name and your email address, then:

| Item | Where it goes |
|---|---|
| **Settings** | Account settings, on the **Profile** tab |
| **Privacy** | The privacy document |
| **Terms** | The terms document |
| **Sign out** | Ends this session and lands on the sign-in screen |

If signing out fails, the page stays where it is and reports "Signing out did not work. Try again."

---

## 8. Common situations

**I want to make somebody a Platform Admin.**
**Admin** → **Users** → type the start of their address into **Search by email address** → **Search**
→ the **Platform role** dropdown on their row → **Platform Admin** → "Change the role" in the dialog.

**I want to take somebody's Platform Admin role away.**
**Admin** → **Users** → find their row → the **Platform role** dropdown → the role they should hold
instead, such as **Instructor** or **Student** → "Change the role". They are signed out of every
device at once and hold only the new role when they sign back in. Their memberships and rosters are
untouched.

**I want to let somebody build and confirm scenario packages.**
**Admin** → **Users** → their row → **Scenario Editor** → "Change the role". They author the packages
of the institutions they belong to. If they belong to none yet, open a section roster of that
institution → **Invite to institution** with their address; they accept the email, and the shelf is
theirs. As a Scenario Editor they can also take runs, like any student.

**I want to make somebody an instructor.**
**Admin** → **Users** → their row → **Instructor** → "Change the role". If they already sit on a
section roster, they now teach that course. Otherwise they can create a course of their own, or an
instructor of an existing course can add them to one of its section rosters.

**I want to change my own role.**
You cannot. Your own row shows its role as plain text, and the screen says "Your own role is set by
another admin." Ask another Platform Admin.

**I want to stop the assistant calling a model right now.**
**Admin** → **Flags** → **Assistant mode** → **Scripted assistant** → **Save assistant mode**. It
takes effect on the next request, with no deploy. Students already in a run carry on; their next
assistant reply comes from the fixture.

**I want to put the live model back.**
**Admin** → **Flags** → **Assistant mode** → **Live model** → **Save assistant mode**. Then check
the **Effective mode** line reads **Live model**. If it still reads **Scripted assistant**, look at
**FEATURE_AI** and at **Effective model provider**: the environment is overruling the switch, and
that is an environment change and a deploy.

**I want to check this deployment before a class or a demo.**
**Admin** → **Flags**. Read, in order: **FEATURE_AI** **On**; **FEATURE_TEST_CONTROLS** **On** if an
instructor will use the armed outage; **Effective model provider** a network provider rather than
`mock`; **Effective mode** **Live model**; and the month sentence under **Model usage** well short
of the whole budget.

**I want to know what the assistant has cost this month.**
**Admin** → **Flags** → **Model usage** → the **This month** column, and the sentence under the
table for the share of the budget it represents.

**A student says the assistant is unavailable.**
**Admin** → **Flags** → **Model usage**. If the month sentence says the budget is spent, that is the
cause and no amount of retrying will help until the calendar month turns. If the budget is fine,
switch **Assistant mode** to **Scripted assistant** to get the class moving, then investigate the
provider.

**I want to prove errors from this deployment are reaching the dashboard.**
**Admin** → **Flags** → **Sentry** → **Send a test event to Sentry**. Quote the identifier it
reports to whoever is watching. If the button will not press, this deployment has no reporting
address configured, and the sentence above the button says so.

**I want to know who changed a band on a run.**
**Admin** → **Audit log** → choose the institution in **Institution** → **Apply** → find the
`band.decide` rows whose **Target** is that run → **Open the record** on the one you want. It names
the dimension, the decision and the band. The **Actor** is the account's identifier, and the
**Request** ties it to the rest of that request.

**I want to know who changed a course's band-to-points mapping.**
**Admin** → **Audit log** → **Institution** → **Apply** → look for `mapping.change` → **Open the
record**, which carries the old mapping, the new one, and how many runs were affected.

**I want to see every role change ever made.**
**Admin** → **Audit log** → leave the filter on **Every institution** → look for `role.set` rows,
whose **Institution** column reads **Platform** → **Open the record** for the role it was, the role
it became, and how many sessions were ended.

**I want to see a course, a run or a review queue.**
**Courses** or **Review** in the left rail. They show the institution named in the header; switch
institution there if the platform has more than one. Everything on them is described in
[the instructor manual](01-instructor.md).

**I want to read a student's run to settle a dispute.**
**Review** → the run, or **Courses** → the course → the assignment → **Open the replay**. You read the
run as its instructors do. Anything you change there — a band, a correction, a void — is written to
the audit log as your act, and the student sees its effect exactly as they would an instructor's.

**I want to hand the platform over to somebody else.**
**Admin** → **Users** → their row → **Platform Admin** → "Change the role". Confirm the change shows
in the audit log as a `role.set` row. Only then consider removing your own role — which another
admin has to do for you — or closing your account.

---

## 9. Error messages and what they mean

### Refusals and failures

| Message on screen | When it appears | Why | What to do |
|---|---|---|---|
| **Not found** — "There is nothing at this address. It may have moved, or the link may be wrong." with **Go home** | Opening an address that names nothing: a run, a course or a package version that does not exist, or no longer does | Every institution is open to you, so this page means the thing is not there | Press **Go home**, and check the address |
| "Sign in to continue." | A request made after the session ended | The session expired, or it was ended elsewhere | Sign in again |
| "You do not have permission to do this." | The answer somebody who is not a Platform Admin gets when their request reaches an admin capability | Their role does not allow the act | Nothing on your side; it is the correct refusal |
| "You cannot change your own platform role: the change would sign you out of the role that is the only way back. Another admin can do it." | An attempt to change your own role | Deliberate: the change would lock you out of the role that could undo it | Ask another Platform Admin |
| "That account no longer exists." | Setting a role on a closed account, or on one that has been removed since the page was drawn | The account is gone | Reload the list |
| "That is not a role that can be set here." | A role value outside the four | Only **Platform Admin**, **Scenario Editor**, **Instructor** and **Student** exist | Choose one of the four offered |
| "FEATURE_AI is off in this environment, so the assistant is already scripted and this switch cannot change it." | Saving **Assistant mode** while **FEATURE_AI** is **Off** | The environment has already forced the fixture; the switch can only narrow, never widen | Nothing on this screen. Turning the flag on is an environment change and a deploy |
| "Too many requests. Try again shortly." | Many actions in quick succession | A rate limit — six hundred reads and sixty writes a minute per account | Wait a few seconds and repeat the action |
| "Something went wrong" — "The problem has been recorded. If it continues, quote the reference below.", with **Reference** and **Try again** | An unexpected failure on the server | A defect | Press **Try again**. If it repeats, quote the reference shown |
| "Invalid cursor." | Only after editing the address bar of a paged list by hand | The paging marker in the address is not one Tassl wrote | Go back to the screen without the edited address |

### Account and settings messages

| Message | When | What to do |
|---|---|---|
| "That is not your current password." | Changing your password with the wrong current one | Retype the current password |
| "Use between 12 and 128 characters." | A new password outside that range | Choose one inside it |
| "Both passwords must be the same." | The two new-password fields differ | Retype them to match |
| "Enter your name." / "Use 120 characters or fewer." | Saving an empty or over-long name | Correct the field |
| "The device list could not be loaded." | The signed-in devices panel could not read the list | Reload the screen |
| "You can download your data twice an hour. Try again shortly." | A third data download inside an hour | Wait, then download again |
| "The download did not start. Try again in a moment." | A data download that failed | Try again |
| "Type the email address of this account to confirm." | Confirming account deletion with a different address typed | Type this account's own address exactly |
| "The account was not deleted. Try again." | Account closure failed | Try again |
| "That notification no longer exists." | Marking a notification that has since gone | Reload the notifications screen |
| "Signing out did not work. Try again." | Sign-out failed | Press **Sign out** again |

### Empty states and disabled controls

| What you see | What it means |
|---|---|
| "No accounts yet" — "The first account will appear here as soon as somebody signs up." | The platform has no accounts at all |
| **No address starts with that** — "The search matches the start of an email address. Clear it to see every account." | The search text is not the beginning of any address. Press **Clear** |
| "A closed account holds no role, and is removed thirty days after it closes." | The row is a closed account; it has no role and no control |
| "Your own role is set by another admin." | The row is yours; only another Platform Admin can change it |
| "Nothing audited yet" — "A role change, a band decision, an export or a deletion writes the first row here." | Nothing consequential has happened on this platform yet |
| "Nothing audited for that institution" — "Nothing has been audited for the institution this filter names. The whole log may still have rows in it." | The filter matched no rows. Use "Show every institution" |
| "No record" in the **Record** column | That act recorded nothing beyond the row itself |
| "FEATURE_AI is off in this environment, so the assistant is scripted whatever is chosen here. Turn the flag on and redeploy to make this switch live." | Why **Save assistant mode** is disabled |
| "NEXT_PUBLIC_SENTRY_DSN is empty in this deployment, so the SDK is off and nothing leaves it. The button does nothing until a DSN is set and the app redeployed." | Why **Send a test event to Sentry** is disabled |
| **Nothing yet** — "Tassl writes here when a run is scored, a package finishes generating, or an instructor confirms your bands." | You have no notifications, which is normal for this role |
| **Waiting for an invitation** / **No institution yet** | No institution exists on this deployment yet, so the screens that belong to one have nothing to show |
| **No other device is signed in.** | This is the only live session on your account |

---

## 10. Glossary

**Account** — One person's sign-in to Tassl: a name, an email address, a password, and exactly one
role.

**Admin area** — The three screens behind the **Admin** rail item: **Users**, **Flags** and **Audit
log**. Open only to a Platform Admin.

**Assistant** — The AI in the room during a student's run. It answers requests inside the scenario
and raises claims, and it never says whether a claim is sound.

**Assistant mode** — The runtime switch on the **Flags** screen choosing between **Live model** and
**Scripted assistant**. The only setting in Tassl that changes without a deploy.

**Audit log** — The append-only record of every consequential act on the platform. Nothing in it can
be edited or removed.

**Band** — The placement one of the seven dimensions of a run holds: Novice, Developing, Proficient,
Professional, or Unassessed. Drafted by Tassl, decided by an instructor or a Platform Admin.

**Closed account** — An account whose owner deleted it. It stops working at once, shows the
**Deleted** chip in the users table, holds no role, and is removed thirty days later.

**Course export** — The versioned document a reviewer files for one run so the institution can enter
a result in its own gradebook.

**Deployment** — One running installation of Tassl, with its own environment, its own database and
its own flags. The **Flags** screen describes the deployment you are signed in to.

**Data agreement** — An institution's record of what its data may be used for, by which roles, for
how long. Only a Platform Admin reads and writes one; there is no screen for it in this build, and a
change to one writes a row to the audit log.

**Effective model provider** — The provider the run loop would actually call right now, once the
flags and the assistant mode have both been read.

**Estimated cost** — The model spend implied by the tokens counted, at this deployment's configured
rates. An estimate; the provider's invoice is the authority.

**Fixture** — The built-in scripted assistant. Deterministic, free, and nothing a student writes
leaves the deployment when it is answering.

**Flag** — One of four settings that come from the deployment's environment: **FEATURE_AI**,
**FEATURE_SAMPLE_DATA**, **FEATURE_TEST_CONTROLS**, **DEMO_MODE**. Changing one is a deploy.

**Institution** — The tenant an account can belong to. It owns courses, sections, rosters,
assignments, packages and runs. A Platform Admin belongs to none by default, and reaches every one
without a membership.

**Instructor** — The role that runs courses, sections, rosters, invitations and assignments, and
reads and decides the runs of the courses it created or teaches. It reads packages and does not
confirm them.

**Judgment Record** — The permanent artifact a student can download once their bands are confirmed.

**Platform role** — The one role an account holds: **Platform Admin**, **Scenario Editor**,
**Instructor** or **Student**. Set on the **Users** screen by a Platform Admin; a new account starts
as **Student**.

**Request identifier** — The value in the audit log's **Request** column, tying together every row
written by one request and matching the deployment's own server log.

**Review queue** — The list of runs with bands to decide. An instructor sees the courses they teach;
a Platform Admin sees every institution's.

**Run** — One student's single attempt at one assignment, kept as a full record of everything they
did. Open to that student, to the instructors of the course, and to a Platform Admin.

**Scenario package** — One authored decision case: the brief, the documents, the claims the
assistant states, the Turn and the questions. A version of one is confirmed and frozen before an
assignment can run on it, by a Scenario Editor or a Platform Admin.

**Scenario Editor** — The role with a Student's access plus authoring: building, editing and
confirming the scenario packages of the institutions it belongs to.

**Section** — One division of a course, with its own roster. Every assignment belongs to one.

**Seed record** — The licensed published case a scenario package was adapted from. Kept with the
package, shown to no student and no instructor; open to Scenario Editors and a Platform Admin.

**Session** — One signed-in device. Changing a role deletes every session the affected account holds.

**Student** — The role every new account starts with: taking the runs assigned to the sections the
account is on, and reading its own results.

**Token** — The unit a model provider bills by. The **Model usage** table counts the input and
output tokens of every call a provider answered.

**Token budget** — The ceiling past which model calls are refused: one per person per UTC day, and
one for the whole platform per calendar month. Both are stated in words under the **Model usage**
table.
