// The access-control statement and roles of docs/tech/08-auth-authz.md §3 live in
// src/lib/auth/access-control.ts: the browser auth client needs them and `src/lib` never imports
// `src/server` (04 §2, D-170). This module keeps the import path the auth spec names for server code.
export * from '@/lib/auth/access-control'
