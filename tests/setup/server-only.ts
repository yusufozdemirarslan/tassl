// Test stand-in for the `server-only` package (aliased in vitest.config.ts).
//
// `server-only` is a poison pill: its default export throws on import, and only a bundler that
// resolves the `react-server` export condition gets the empty build instead. Next.js does that for
// server code; Vitest does not, so `import 'server-only'` in src/server/auth/session.ts (08 §2.6)
// would abort every suite that reaches the session helpers. Aliasing to this empty module restores
// the behaviour the React Server Components compiler has. The real client/server boundary is
// enforced by the ESLint boundaries rule (src/lib and src/components may not import src/server) and
// by Next.js itself at build time.
export {}
