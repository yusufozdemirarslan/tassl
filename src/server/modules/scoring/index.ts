// Module `scoring` — the public door (docs/tech/04-repo-structure.md §2; 10 §11).
//
// Everything another module, a route, a job handler or a Server Component may reach passes through
// here: the four graph builders and the rubric (Step 10.2), the facts, the bands, the points and the
// neutralization recompute (Step 10.3), and `scoreRun`, `getScore` and `readScore` (Step 10.4).
//
// The `score_run` job handler reaches `scoreRun` through this file, which is the door 10 §7's queue
// table names and the one a job handler is allowed (D-173).
export * from './service'
