// The platform screens (UI-050, SYS-006, D-016): users and platform roles, the flag view, and the
// audit log. Nobody but a platform admin ever reads one of these strings — a student who types the
// address is shown the not-found page — but they are held to the same voice rules as every other
// namespace, and the same catalogue.
import { scopedT } from '../scoped'

export const admin = {
  'admin.tabsLabel': 'Admin sections',
  'admin.tabUsers': 'Users',
  'admin.tabFlags': 'Flags',
  'admin.tabAudit': 'Audit log',

  // Users (UI-050)
  'admin.users.title': 'Users',
  'admin.users.description':
    'Every account on the platform, newest first. A platform role is a right over Tassl itself, not a seat in an institution — those are set on the institution’s roster.',
  'admin.users.searchLabel': 'Search by email address',
  'admin.users.searchPlaceholder': 'Start of an email address',
  'admin.users.searchSubmit': 'Search',
  'admin.users.searchClear': 'Clear',
  'admin.users.caption': 'Accounts, newest first',
  'admin.users.columnName': 'Name',
  'admin.users.columnEmail': 'Email',
  'admin.users.columnRole': 'Platform role',
  'admin.users.columnJoined': 'Joined',
  'admin.users.empty': 'No accounts yet',
  'admin.users.emptyBody': 'The first account will appear here as soon as somebody signs up.',
  'admin.users.emptySearch': 'No address starts with that',
  'admin.users.emptySearchBody':
    'The search matches the start of an email address. Clear it to see every account.',
  'admin.users.deletedLabel': 'Deleted',
  'admin.users.selfLabel': 'You',
  'admin.users.roleLabel': 'Platform role for {name}',
  'admin.users.roleSelfNote': 'Your own role is set by another admin.',
  'admin.users.roleDeletedNote':
    'A closed account holds no role, and is removed thirty days after it closes.',
  'admin.users.loadMore': 'Show more accounts',
  'admin.users.loadMoreBusy': 'Loading',

  'admin.users.confirmTitle': 'Change this platform role?',
  'admin.users.confirmBody':
    '{name} goes from {from} to {role} on the platform. This signs them out of every device straight away, and the change is written to the audit log with your name on it.',
  'admin.users.confirmSubmit': 'Change the role',
  'admin.users.confirmCancel': 'Leave it as it is',
  'admin.users.roleSaved': '{name} is now {role} on the platform, and is signed out everywhere.',

  // Flags (UI-050)
  'admin.flags.title': 'Flags',
  'admin.flags.description':
    'What this deployment is running with. Every one of them comes from the environment, so changing one is a deploy and not a switch on this screen.',
  'admin.flags.caption': 'The three deployment flags, and what each one changes',
  'admin.flags.columnFlag': 'Flag',
  'admin.flags.columnValue': 'Value',
  'admin.flags.columnSource': 'Source',
  'admin.flags.columnMeaning': 'What it does',
  'admin.flags.source': 'Environment',
  'admin.flags.on': 'On',
  'admin.flags.off': 'Off',
  'admin.flags.ai': 'FEATURE_AI',
  'admin.flags.aiMeaning':
    'Off forces the built-in fixture model everywhere, whatever LLM_PROVIDER says. The product is whole either way.',
  'admin.flags.sampleData': 'FEATURE_SAMPLE_DATA',
  'admin.flags.sampleDataMeaning':
    'Shows the illustrative sample panels, each carrying its own label so nobody reads one as a real run.',
  'admin.flags.testControls': 'FEATURE_TEST_CONTROLS',
  'admin.flags.testControlsMeaning':
    'Lets an instructor arm the assistant outage inside a live run. Every use is written to the audit log.',
  'admin.flags.providerTitle': 'Effective model provider',
  'admin.flags.providerDescription':
    'The provider the run loop would actually call right now, which is the mock whenever FEATURE_AI is off.',
  'admin.flags.providerMockNote':
    'This deployment answers the assistant from a fixture: no run text reaches a model provider.',
  // 11 §3's constrained-mode sentence, on the one screen it belongs on (D-655). It is written for an
  // operator asking what this deployment is running with, and it is deliberately absent from every
  // student surface: with FEATURE_AI off the product is whole (D-029), and a banner telling a
  // student their assistant is "constrained" would describe a degradation they are not in and would
  // be a change that `FEATURE_AI=false` is not allowed to make.
  'admin.flags.constrainedMode':
    'AI features are running in constrained mode: every model call is answered by the built-in fixture provider, which is deterministic and costs nothing.',

  // Model usage (NFR-016, D-065): the same sums the budget guardrail reads, on the same clock.
  'admin.flags.usageTitle': 'Model usage',
  'admin.flags.usageDescription':
    'What this deployment has spent with a model provider. These are the sums the budget guard reads before every call, so a call refused for being over budget is refused against exactly these numbers. Calls the built-in fixture provider answered are not counted: nobody was billed for them.',
  'admin.flags.usageCaption': 'Model calls, tokens and estimated cost, today and this month',
  'admin.flags.usageColumnMeasure': 'Measure',
  'admin.flags.usageColumnToday': 'Today (UTC)',
  'admin.flags.usageColumnMonth': 'This month',
  'admin.flags.usageCalls': 'Calls',
  'admin.flags.usageTokens': 'Tokens',
  'admin.flags.usageCost': 'Estimated cost',
  'admin.flags.usageMonthlyBudget':
    'The month has used {used} of the {budget} tokens in LLM_GLOBAL_MONTHLY_TOKEN_BUDGET, which is {share}. Past it, every model call is refused until the calendar month turns.',
  'admin.flags.usageDailyBudget':
    'LLM_USER_DAILY_TOKEN_BUDGET is {budget} tokens per person per UTC day. It is counted per person, so the platform-wide figure above is not measured against it.',

  // Audit log (UI-050, DATA-048)
  'admin.audit.title': 'Audit log',
  'admin.audit.description':
    'One row for each consequential act, newest first, with the request it belonged to. Rows are append-only: nothing here can be edited or removed.',
  'admin.audit.filterLabel': 'Institution',
  'admin.audit.filterAll': 'Every institution',
  'admin.audit.filterSubmit': 'Apply',
  'admin.audit.filterTruncated':
    'The first {count} institutions by name. A deployment with more than that has institutions this filter does not offer.',
  'admin.audit.caption': 'Audit rows, newest first',
  'admin.audit.columnTime': 'Time',
  'admin.audit.columnActor': 'Actor',
  'admin.audit.columnAction': 'Action',
  'admin.audit.columnTarget': 'Target',
  'admin.audit.columnOrg': 'Institution',
  'admin.audit.columnRequest': 'Request',
  'admin.audit.columnRecord': 'Record',
  'admin.audit.openRecord': 'Open the record',
  'admin.audit.noRecord': 'No record',
  'admin.audit.systemActor': 'System',
  'admin.audit.platformOrg': 'Platform',
  'admin.audit.empty': 'Nothing audited yet',
  'admin.audit.emptyBody':
    'A role change, a band decision, an export or a deletion writes the first row here.',
  'admin.audit.emptyFiltered': 'Nothing audited for that institution',
  'admin.audit.emptyFilteredBody':
    'Nothing has been audited for the institution this filter names. The whole log may still have rows in it.',
  'admin.audit.emptyFilteredAction': 'Show every institution',
  'admin.audit.loadMore': 'Show more rows',
  'admin.audit.loadMoreBusy': 'Loading',

  // Service refusals
  'admin.roleSelfRefused':
    'You cannot change your own platform role: the change would sign you out of the seat that is the only way back. Another admin can do it.',
  'admin.userNotFound': 'That account no longer exists.',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(admin)
