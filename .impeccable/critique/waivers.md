# Impeccable detector waivers

Every entry in `.impeccable/config.json` → `detector.ignore*` is recorded here with its reason (09-frontend-spec.md §4, D-130). Waivers are the narrowest possible: one rule, one value, scoped to one file.

| Rule       | Value | File                                   | Reason                                                                                                                                                                                                                                                                              | Recorded             |
| ---------- | ----- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `side-tab` | `*`   | `src/components/layout/label-chip.tsx` | Specified, not generated: `16-performance-a11y-budgets.md` §8.7 and DESIGN.md §Shapes require the draft/provisional/uncalibrated chip to be ink text with a 2 px amber left border and an amber icon (D-122). The element is a 20 px label chip, not a card, list item, or callout. | 2026-09-03, Step 1.6 |
