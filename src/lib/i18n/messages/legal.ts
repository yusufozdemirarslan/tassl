// The legal pages (UI-006, SYS-007, D-017). Every sentence here is a claim about this codebase,
// and each was checked against the code before it was written: the table of what is stored against
// `src/server/db/schema/**`, the retention lines against `identity/retention.ts` and the purge
// job's SQL, the export line against `exportUserData`, and the processor rows against the
// configuration the page reads at render time. A privacy page that describes a product we did not
// build is worse than no page at all, so a claim with nothing behind it is not written here.
import { scopedT } from '../scoped'

export const legal = {
  // ---------------------------------------------------------------------------------------------
  // Shared chrome
  // ---------------------------------------------------------------------------------------------
  'legal.privacyTitle': 'Privacy',
  'legal.termsTitle': 'Terms',
  'legal.lastReviewed': 'Last reviewed {date}',
  'legal.lastReviewedNote':
    'A person reads both pages against the code before each release, and records the date in the release notes. The date above is the last time that happened.',
  'legal.contentsLabel': 'On this page',
  'legal.deploymentNote':
    'The two lists below are generated from this installation’s own configuration rather than from a template. A service that is switched off here is not named here.',
  'legal.contactHeading': 'Who to write to',
  'legal.contactBody':
    'Write to {email}. Your institution holds the course record this product produces, so anything about a run, a band or a course goes to your instructor or program lead first.',

  /**
   * FR-006, and the one place in the whole catalogue the word is allowed to appear twice: the
   * sentence exists to deny the thing it names. `tests/unit/copy/never-accuses.test.ts` pins it.
   */
  'legal.noMisconductFindings':
    'Tassl makes no misconduct findings. Nothing it records — how long you took, what you asked the assistant, or whether you declared using a tool outside Tassl — is treated as misconduct or reported as such, and there is no detection, proctoring, or similarity checking anywhere in the product.',

  // ---------------------------------------------------------------------------------------------
  // Privacy
  // ---------------------------------------------------------------------------------------------
  'legal.privacy.summary':
    'What Tassl stores about you, why it stores it, how long it keeps it, and what you can do about it.',

  'legal.privacy.scope.heading': 'What this page covers',
  'legal.privacy.scope.body':
    'You reach Tassl through an institution. The institution decides who has an account, which courses exist, and what a confirmed band is worth; Tassl runs the Decision Run and keeps the record of it. This page describes what the product itself stores and what it does with it.',
  'legal.privacy.scope.controller':
    'For the course record — who took which run, and what their instructor decided — your institution is the one who answers. For everything on this page, Tassl is.',

  'legal.privacy.collected.heading': 'What Tassl stores',
  'legal.privacy.collected.caption': 'What Tassl stores about you, and where each item comes from',
  'legal.privacy.collected.columnWhat': 'What',
  'legal.privacy.collected.columnDetail': 'Detail',
  'legal.privacy.collected.columnSource': 'Where it comes from',

  'legal.privacy.collected.account': 'Your account',
  'legal.privacy.collected.accountDetail':
    'Your name, your email address, whether that address is confirmed, and your password, which is stored hashed and never in the clear.',
  'legal.privacy.collected.accountSource': 'You, when you sign up or accept an invitation.',

  'legal.privacy.collected.sessions': 'Your signed-in devices',
  'legal.privacy.collected.sessionsDetail':
    'For each device with a live session: the network address the request arrived from and the browser string it sent. You can see the list, and end any of them, in Settings.',
  'legal.privacy.collected.sessionsSource': 'Your browser, at sign-in.',

  'legal.privacy.collected.google': 'Google sign-in',
  'legal.privacy.collected.googleDetail':
    'The account identifier and the tokens Google returns, so the button knows it is you next time.',
  'legal.privacy.collected.googleSource': 'Google, when you choose that way in.',

  'legal.privacy.collected.seats': 'Your seats',
  'legal.privacy.collected.seatsDetail':
    'Which institution you belong to and in what role, and which courses and sections you are on.',
  'legal.privacy.collected.seatsSource': 'Your instructor or program lead.',

  'legal.privacy.collected.run': 'Your run',
  'legal.privacy.collected.runDetail':
    'Everything you write in a run: how you frame the decision, what you asked the assistant and what it answered, your stance and confidence on each claim, your decision brief, your response to the Turn, and your defense answers — each with the moment it happened.',
  'legal.privacy.collected.runSource': 'You, during a run.',

  'legal.privacy.collected.result': 'What the run produced',
  'legal.privacy.collected.resultDetail':
    'The seven drafted bands with the sentence behind each, your instructor’s decision on each of them, and the record your course keeps.',
  'legal.privacy.collected.resultSource': 'The run, and your instructor.',

  'legal.privacy.collected.notifications': 'Notifications',
  'legal.privacy.collected.notificationsDetail':
    'The notices the product sends you, and whether you have read them.',
  'legal.privacy.collected.notificationsSource': 'The product.',

  'legal.privacy.collected.model': 'Model-call records',
  'legal.privacy.collected.modelDetail':
    'For each call to a language model: which part of the product made it, how long it took, how many tokens it used and what it cost. The text of the call is not stored — only a one-way digest of the prompt.',
  'legal.privacy.collected.modelSource': 'The product.',

  'legal.privacy.collected.limits': 'Rate-limit counters',
  'legal.privacy.collected.limitsDetail':
    'A per-minute counter kept under your account id, or under the network address when nobody is signed in. It holds a number and nothing else.',
  'legal.privacy.collected.limitsSource': 'Your requests.',

  'legal.privacy.collected.audit': 'Audit rows',
  'legal.privacy.collected.auditDetail':
    'One line for each consequential act — a role change, a band decision, an export, an account deletion — naming who did it, what it was done to, and the request it belonged to.',
  'legal.privacy.collected.auditSource': 'The product.',

  'legal.privacy.collected.absent':
    'Tassl records no audio and no video, takes no screenshots, and measures no typing. A run carries one true-or-false mark saying an accommodation was applied to it, and nothing at all about what the accommodation was.',

  'legal.privacy.purposes.heading': 'Why Tassl stores it',
  'legal.privacy.purposes.run':
    'To run the Decision Run and show you your own work while you do it.',
  'legal.privacy.purposes.bands':
    'To draft the seven bands from what happened in the run, and to let your instructor confirm or change each of them.',
  'legal.privacy.purposes.record':
    'To give your course the record it maps to points, and to let your instructor replay the run beside you.',
  'legal.privacy.purposes.email':
    'To send the few emails the product needs: confirming your address, resetting a password, an invitation, and the notices about your own runs.',
  'legal.privacy.purposes.operate':
    'To keep the service standing: per-minute limits so one account or one address cannot flood it, and reports of errors so they can be repaired.',
  'legal.privacy.purposes.never':
    'Tassl sells nothing you write and shows you no advertising. There is no third party buying any of this.',

  'legal.privacy.limits.heading': 'What Tassl does not do',
  'legal.privacy.limits.declaration':
    'Declaring that you used a tool outside Tassl is recorded, and changes nothing about what your run is worth.',
  'legal.privacy.limits.noTotals':
    'There is no total, no rank and no percentile anywhere in the product. A run holds seven bands, and what a course makes of them is arithmetic your instructor sets in the open.',
  'legal.privacy.limits.hidden':
    'While a run is live it hides its own answer key from you: which stance was warranted, which document was planted, what the checks would have found. That is a rule about the run, not a judgment about you, and your debrief opens all of it the moment the run is scored.',

  'legal.privacy.processors.heading': 'Who else handles it',
  'legal.privacy.processors.caption': 'The services this installation passes data to',
  'legal.privacy.processors.columnService': 'Service',
  'legal.privacy.processors.columnHandles': 'What it handles',
  'legal.privacy.processors.columnWhy': 'Why',

  'legal.privacy.processors.database': 'Neon',
  'legal.privacy.processors.databaseHandles': 'Every row in the table above.',
  'legal.privacy.processors.databaseWhy': 'It is the managed Postgres this installation runs on.',
  'legal.privacy.processors.databaseLocal': 'A Postgres server on this machine',
  'legal.privacy.processors.databaseLocalHandles': 'Every row in the table above.',
  'legal.privacy.processors.databaseLocalWhy':
    'This installation is a local one; nothing leaves the machine it runs on.',

  'legal.privacy.processors.hosting': 'Vercel',
  'legal.privacy.processors.hostingHandles':
    'Every request to the product, and the nightly job run.',
  'legal.privacy.processors.hostingWhy': 'It is the hosting this installation runs on.',

  'legal.privacy.processors.email': 'Resend',
  'legal.privacy.processors.emailHandles': 'The address a message goes to, and the message itself.',
  'legal.privacy.processors.emailWhy': 'It delivers the product’s email.',

  'legal.privacy.processors.google': 'Google',
  'legal.privacy.processors.googleHandles':
    'Your Google account identifier, when you choose the Google button.',
  'legal.privacy.processors.googleWhy': 'It is the identity provider behind that button.',

  'legal.privacy.processors.analytics': 'PostHog',
  'legal.privacy.processors.analyticsHandles':
    'Product events, identified by a one-way digest of your account id rather than by your name or your address.',
  'legal.privacy.processors.analyticsWhy': 'It is where use of the product is counted.',

  'legal.privacy.processors.monitoring': 'Sentry',
  'legal.privacy.processors.monitoringHandles':
    'Reports of errors: the message, the code path, and the request id they belong to.',
  'legal.privacy.processors.monitoringWhy':
    'It is where errors are collected so they get repaired.',

  'legal.privacy.processors.model': 'The model provider ({provider}, {model})',
  'legal.privacy.processors.modelHandles':
    'What the assistant is given to answer with: your request, and the parts of the brief and the documents you have opened.',
  'legal.privacy.processors.modelWhy': 'It is the model behind the assistant in the run.',
  'legal.privacy.processors.modelNone':
    'The assistant in this installation answers from a built-in fixture rather than from a model provider, so nothing you write in a run reaches one.',

  'legal.privacy.retention.heading': 'How long Tassl keeps it',
  'legal.privacy.retention.business':
    'Your account, your seats, your runs and their records stay for as long as the institution keeps the course record. Tassl does not delete them on a timer.',
  'legal.privacy.retention.sessions':
    'A session lasts 30 days unless you end it sooner; the address and browser string stored with it go when it does.',
  'legal.privacy.retention.limits':
    'Rate-limit counters are deleted within a few minutes of the minute they count.',
  'legal.privacy.retention.deletion':
    'Deleting your account stops it working at once. Thirty days later the account row and everything personal on it is removed: your runs stay with the course under a placeholder account so the course record survives, and the audit and model-call rows lose your id.',
  'legal.privacy.retention.logs':
    'Request logs and error reports are held by the hosting and monitoring services under their own settings. Tassl’s own database keeps none of them.',

  'legal.privacy.rights.heading': 'What you can do',
  'legal.privacy.rights.correct': 'Correct your name in Settings, under Profile.',
  'legal.privacy.rights.devices':
    'See every device holding a live session, and end any of them, in Settings under Security.',
  'legal.privacy.rights.export':
    'Download what Tassl holds from Settings, under Data. The file carries your profile, your institution and section memberships, your notifications, and the audit rows where you are the one who acted. Twice an hour.',
  'legal.privacy.rights.exportGap':
    'Your run content is not in that file yet. Each run’s own record, with its full event trace, downloads from the run’s record page once its bands are confirmed.',
  'legal.privacy.rights.delete':
    'Delete your account from Settings, under Data. It stops working immediately and is past undoing after thirty days.',
  'legal.privacy.rights.institution':
    'Ask your institution about anything it holds: the course record, the roster, and who may read a run are its decisions, not the product’s.',

  // ---------------------------------------------------------------------------------------------
  // Terms
  // ---------------------------------------------------------------------------------------------
  'legal.terms.summary':
    'What an account is for, what the product decides and what it leaves to your instructor, and how access ends.',

  'legal.terms.agreement.heading': 'What this is',
  'legal.terms.agreement.body':
    'Tassl is provided to your institution under the agreement it signed with us. This page is the plain-language part of that arrangement, written for the person using the product; where the two are read together, the signed agreement is the one that governs.',
  'legal.terms.agreement.changes':
    'These terms change as the product does. The date above says when a person last read this page against the code.',

  'legal.terms.account.heading': 'Your account',
  'legal.terms.account.body':
    'An account belongs to one person and reaches Tassl through one institution. Keep your password to yourself and do not let anyone else sign in as you: a run is a record of what one person did under a clock, and it is worth nothing if two people made it.',
  'legal.terms.account.sessions':
    'Changing your password ends every other live session. So does a change to your platform role, which signs you out everywhere on the spot.',

  'legal.terms.use.heading': 'Using the product',
  'legal.terms.use.material':
    'A scenario package — its brief, its documents, its claims and the material behind them — belongs to its author or to the institution that licensed it, and is there for the course you meet it in.',
  'legal.terms.use.boundaries':
    'Do not try to reach another person’s run, or the parts of a scenario the run keeps from you while it is live. Both are refused by the product; asking anyway is the thing this line is about.',
  'legal.terms.use.outsideTools':
    'Whether you may use tools outside Tassl during a run is your course’s policy, shown to you before the run starts. The product asks you to declare it and records the declaration; what the declaration is worth is your instructor’s to say.',

  'legal.terms.decisions.heading': 'What Tassl decides, and what it does not',
  'legal.terms.decisions.bands':
    'Tassl drafts seven bands from what happened in the run and shows the reasoning for each. Your instructor confirms or changes every one of them, and the course maps the confirmed bands to points. The product assigns no grade.',
  'legal.terms.decisions.appeal':
    'A band you disagree with is a conversation with your instructor, who can change it. There is nothing in the product that a person cannot overrule.',

  'legal.terms.ending.heading': 'How access ends',
  'legal.terms.ending.institution':
    'Your institution can end your access to a course or to the product; the runs already recorded stay with the course.',
  'legal.terms.ending.self':
    'You can delete your own account from Settings, under Data. What happens to what Tassl holds is set out on the privacy page.',

  'legal.terms.liability.heading': 'What we do not promise',
  'legal.terms.liability.body':
    'Tassl is a teaching instrument, not an assessment of a person. Nothing it produces is a professional judgment about anyone’s ability, and it is not offered as one.',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(legal)
