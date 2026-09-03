## Summary

Step(s): `Step N.M` — <!-- what this PR implements, in one or two sentences -->

## Checklist (docs/tech/04-repo-structure.md §6)

- [ ] Steps referenced by `Step N.M` in the description; `PROGRESS.md` ticked
- [ ] Every new endpoint has an integration test and appears in `openapi.yaml` (`pnpm openapi:check` passes)
- [ ] Every new screen passed `/impeccable critique`, `audit`, `harden`, `polish` and has an axe E2E
- [ ] New env vars added to `.env.example` and `05-environment-config.md`
- [ ] New decisions appended to `DECISIONS.md`
- [ ] Migrations are expand-only for this release
