// Development-only routes (the component gallery, UI-060) exist in local and test builds and are a
// 404 everywhere else (09-frontend-spec.md §1; 16 §3.5 extends the rule to CI).
export const devRoutesEnabled = (appEnv: string): boolean => appEnv === 'local' || appEnv === 'test'
