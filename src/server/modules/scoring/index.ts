// Module `scoring` — the public door (docs/tech/04-repo-structure.md §2; 10 §11).
//
// Everything another module, a route, a job handler or a Server Component may reach passes through
// here. Step 10.2 opens it with the four graph builders; `scoreRun`, `getScore` and the
// neutralization recompute join them in Steps 10.3 and 10.4.
export * from './service'
