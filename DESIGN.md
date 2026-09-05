---
name: Tassl
description: Instrument panel for a decision simulator — calm, high-contrast, dense where data is dense, generous where the student writes.
colors:
  paper: '#F6F7F9'
  paper-raised: '#FFFFFF'
  paper-sunken: '#ECEFF3'
  ink: '#141A26'
  ink-muted: '#4B5563'
  ink-faint: '#8A93A3'
  line: '#D5DAE2'
  line-strong: '#AEB6C2'
  line-control: 'rgb(20 26 38 / 0.55)'
  primary: '#0F6E74'
  primary-ink: '#FFFFFF'
  primary-soft: '#DDEFF0'
  amber: '#B7791F'
  amber-soft: '#FBF1DC'
  red: '#A23B2A'
  red-soft: '#F8E5E1'
  green: '#2E7D4F'
  green-soft: '#E1F1E7'
  focus: '#0F6E74'
  stance-accept: '#2E7D4F'
  stance-verify: '#0F6E74'
  stance-challenge: '#B7791F'
  stance-reject: '#A23B2A'
  stance-escalate: '#5B4B9A'
typography:
  display:
    fontFamily: 'IBM Plex Serif, Georgia, Times New Roman, serif'
    fontSize: '36px'
    fontWeight: 600
    lineHeight: '44px'
  headline:
    fontFamily: 'IBM Plex Serif, Georgia, Times New Roman, serif'
    fontSize: '30px'
    fontWeight: 500
    lineHeight: '38px'
  title:
    fontFamily: 'IBM Plex Serif, Georgia, Times New Roman, serif'
    fontSize: '24px'
    fontWeight: 500
    lineHeight: '32px'
  subtitle:
    fontFamily: 'IBM Plex Serif, Georgia, Times New Roman, serif'
    fontSize: '20px'
    fontWeight: 500
    lineHeight: '28px'
  lead:
    fontFamily: 'IBM Plex Sans, system-ui, Segoe UI, Helvetica Neue, Arial, sans-serif'
    fontSize: '18px'
    fontWeight: 400
    lineHeight: '28px'
  reading:
    fontFamily: 'IBM Plex Sans, system-ui, Segoe UI, Helvetica Neue, Arial, sans-serif'
    fontSize: '16px'
    fontWeight: 400
    lineHeight: '26px'
  body:
    fontFamily: 'IBM Plex Sans, system-ui, Segoe UI, Helvetica Neue, Arial, sans-serif'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: '22px'
  label:
    fontFamily: 'IBM Plex Sans, system-ui, Segoe UI, Helvetica Neue, Arial, sans-serif'
    fontSize: '13px'
    fontWeight: 500
    lineHeight: '20px'
  mono:
    fontFamily: 'IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: '20px'
    fontFeature: '"tnum" 1'
  mono-dense:
    fontFamily: 'IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    fontSize: '12px'
    fontWeight: 400
    lineHeight: '18px'
    fontFeature: '"tnum" 1'
rounded:
  sm: '2px'
  md: '6px'
  lg: '10px'
spacing:
  1: '4px'
  2: '8px'
  3: '12px'
  4: '16px'
  5: '24px'
  6: '32px'
  7: '48px'
  8: '64px'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.primary-ink}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    padding: '0 16px'
    height: '40px'
  button-secondary:
    backgroundColor: '{colors.paper-raised}'
    textColor: '{colors.primary}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    padding: '0 16px'
    height: '40px'
  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    padding: '0 16px'
    height: '40px'
  button-destructive:
    backgroundColor: '{colors.red}'
    textColor: '{colors.primary-ink}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    padding: '0 16px'
    height: '40px'
  input:
    backgroundColor: '{colors.paper-raised}'
    textColor: '{colors.ink}'
    typography: '{typography.body}'
    rounded: '{rounded.md}'
    padding: '8px 12px'
    height: '40px'
  panel:
    backgroundColor: '{colors.paper-raised}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    padding: '16px'
  chip-label:
    backgroundColor: '{colors.amber-soft}'
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
    padding: '2px 8px 2px 6px'
  chip-stance:
    backgroundColor: '{colors.paper-raised}'
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '999px'
    padding: '6px 12px'
    height: '40px'
  dialog:
    backgroundColor: '{colors.paper-raised}'
    textColor: '{colors.ink}'
    rounded: '{rounded.lg}'
    padding: '24px'
---

# Design System: Tassl

## Overview

**Creative North Star: "The Instrument Panel"**

Tassl is a simulator-style assessor, and its interface is the panel a pilot reads: calm, high-contrast, and honest about state. Nothing decorates; every mark carries information. Density follows the data: the stance matrix, the clock timeline, and the replay trace are tight and monospaced, while everything the student writes (frame, brief, defense) is set in a generous reading measure. The register is Operate on every surface; there is no marketing surface in this product.

The palette is cool paper and tinted ink with one deep-teal voice for action, three semantic colors that are used only when they mean something (amber for draft and provisional, red for refusal and error, green for confirmed and matched), and five stance colors that never appear without a text label and an icon. Depth comes from hairlines and whitespace, not shadows; dialogs and popovers are the one floating layer.

**Key Characteristics:**

- Cool paper ground (`#F6F7F9`) with tinted ink (`#141A26`); no pure black, no pure gray.
- IBM Plex throughout: Serif for headings, Sans for the UI and writing, Mono with tabular figures for trace data and the clock.
- One accent (deep teal) for actions and selection; semantic colors are rare and always redundant with a label or icon.
- Hairline borders and whitespace instead of elevation; cards never nest.
- Motion is short (150–200 ms), ease-out, and removed entirely under `prefers-reduced-motion`.

## Colors

The palette is recorded in `docs/tech/09-frontend-spec.md` §2.2 (D-025, D-122) and declared on `:root` in `src/app/globals.css`; the table below is normative and a unit test keeps the two in sync.

| Token                | Value                  | Use                                                                                                         |
| -------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `--paper`            | `#F6F7F9`              | page ground                                                                                                 |
| `--paper-raised`     | `#FFFFFF`              | panels, cards (never nested)                                                                                |
| `--paper-sunken`     | `#ECEFF3`              | hover and highlight wash, tab wells, disabled inputs, timeline track                                        |
| `--ink`              | `#141A26`              | primary text (tinted, never pure black)                                                                     |
| `--ink-muted`        | `#4B5563`              | secondary text (7.0:1 on paper)                                                                             |
| `--ink-faint`        | `#8A93A3`              | decorative only: gridlines, disabled outlines, hairline icons; never text (3.1:1 on paper-raised, D-153)    |
| `--line`             | `#D5DAE2`              | hairline borders, panel edges, table rules                                                                  |
| `--line-strong`      | `#AEB6C2`              | dashed illustrative-sample borders, emphasized rules                                                        |
| `--line-control`     | `rgb(20 26 38 / 0.55)` | input and control boundaries (3.8:1 on paper, 3.9:1 on white; 16 §8.7, D-157)                               |
| `--primary`          | `#0F6E74`              | actions, links, selected stance (deep teal; 5.59:1 on paper)                                                |
| `--primary-ink`      | `#FFFFFF`              | text on primary (6.0:1)                                                                                     |
| `--primary-soft`     | `#DDEFF0`              | selected row background; text on it is `--primary` or `--ink`                                               |
| `--amber`            | `#B7791F`              | draft, uncalibrated, provisional: borders, icons, and chip fills only; never a text color (3.40:1 on paper) |
| `--amber-soft`       | `#FBF1DC`              | label chip background with `--ink` text                                                                     |
| `--red`              | `#A23B2A`              | refusals, errors, defect rows in the replay (6.13:1 on paper)                                               |
| `--red-soft`         | `#F8E5E1`              | error surfaces; text on it is `--red` or `--ink`                                                            |
| `--green`            | `#2E7D4F`              | confirmed, matched stances (4.71:1 on paper)                                                                |
| `--green-soft`       | `#E1F1E7`              | confirmation surfaces; text on it is `--ink`, the green is the icon                                         |
| `--focus`            | `#0F6E74`              | 2 px outline with 2 px offset on every focusable element                                                    |
| `--stance-accept`    | `#2E7D4F`              | stance chip and matrix cell: accept                                                                         |
| `--stance-verify`    | `#0F6E74`              | stance chip and matrix cell: verify                                                                         |
| `--stance-challenge` | `#B7791F`              | stance chip and matrix cell: challenge                                                                      |
| `--stance-reject`    | `#A23B2A`              | stance chip and matrix cell: reject                                                                         |
| `--stance-escalate`  | `#5B4B9A`              | stance chip and matrix cell: escalate                                                                       |

### Primary

- **Deep Teal** (`#0F6E74`): every action, link, selected state, and the focus ring. It is the one voice on a screen; it is not used for decoration.

### Neutral

- **Cool Paper** (`#F6F7F9`): the page ground. **Raised Paper** (`#FFFFFF`): panels, dialogs, inputs. **Sunken Paper** (`#ECEFF3`): hover and highlight washes, tab wells, disabled input wells, and the timeline track.
- **Tinted Ink** (`#141A26`): all primary text. **Muted Ink** (`#4B5563`): secondary text and metadata. **Faint Ink** (`#8A93A3`): decorative strokes only.
- **Hairline** (`#D5DAE2`) and **Strong Hairline** (`#AEB6C2`): borders and rules. Control boundaries use ink at 55 % alpha (`--line-control`) so they reach 3.8:1 on paper and 3.9:1 on raised paper (D-157).

### Semantic

- **Draft Amber** (`#B7791F`) with **Amber Wash** (`#FBF1DC`): anything draft, provisional, or uncalibrated. Amber appears as a border, an icon, or a chip fill; the text beside it is ink.
- **Refusal Red** (`#A23B2A`) with **Red Wash** (`#F8E5E1`): refusals, errors, defect rows.
- **Confirmed Green** (`#2E7D4F`) with **Green Wash** (`#E1F1E7`): confirmed bands, matched stances.
- **Escalate Violet** (`#5B4B9A`): the fifth stance color; it exists only in the stance set.

### Named Rules

**The Ink-on-Wash Rule.** Text on `--primary-soft`, `--amber-soft`, `--red-soft`, or `--green-soft` is the matching strong color or `--ink`, never gray. No gray text on colored backgrounds, anywhere.

**The Amber-Is-Not-Text Rule.** Amber marks draft state as a 2 px left border, an icon, or a chip fill with ink text. White or gray text is never placed on amber, and amber is never a text color on paper.

**The Labelled-Stance Rule.** A stance color never appears without its text label and its icon (accept `check`, verify `search-check`, challenge `message-square-warning`, reject `x-octagon`, escalate `arrow-up-right`).

## Typography

**Display Font:** IBM Plex Serif (with Georgia, Times New Roman fallback)
**Body Font:** IBM Plex Sans (with system-ui, Segoe UI, Helvetica Neue, Arial fallback)
**Label/Mono Font:** IBM Plex Mono (with ui-monospace, SFMono-Regular, Menlo, Consolas fallback)

Weights shipped: Serif 500 and 600; Sans 400, 500, 600; Mono 400 and 500 with `font-feature-settings: "tnum" 1`. All faces are self-hosted woff2 in `public/fonts/` and loaded through `next/font/local` (`src/app/fonts.ts`); only the Sans faces are preloaded. No italic faces ship: `<em>` renders at weight 500, `<strong>` at 600, and the browser never synthesizes an oblique. Never Inter, Arial, or a system default as the primary face.

**Character:** a technical serif over a humanist grotesque, with a monospace for anything the instrument measures. Headings read like a report; the UI reads like a control surface; numbers line up.

### Hierarchy

- **Display / h1** (Serif 600, 36px, 44px): page titles in `PageHeader`.
- **Headline / h2** (Serif 500, 30px, 38px): section titles.
- **Title / h3** (Serif 500, 24px, 32px): panel titles and empty-state headings. The step names the style, not the element: Panel, EmptyState, ErrorState, and IllustrativeSample take a `headingLevel` prop so the document outline never skips a level (a panel directly under the page h1 renders an h2 in this style).
- **Subtitle / h4** (Serif 500, 20px, 28px): sub-sections inside a panel, the `IllustrativeSample` label, and dialog, sheet, and popover titles.
- **Lead** (Sans 400, 18px, 28px): the scenario brief's opening.
- **Reading** (Sans 400, 16px, 26px): everything the student writes and reads at length (frame, brief, documents, defense); max measure 72ch.
- **Body** (Sans 400, 14px, 22px): the default UI size.
- **Label / meta** (Sans 500, 13px, 20px): buttons, chips, table headers, metadata; sentence case, never uppercase tracking.
- **Mono** (Mono 400/500, 14px, 20px) and **Mono dense** (12px, 18px): trace data, keys, request ids, the clock, matrix cells and timeline labels.

**The Descending-Heading Rule.** Below a panel's Title the levels step down in size only, never in colour: **h3** is
Subtitle (Serif 500, 20/28); **h4** is Serif 500 at the reading size (16/26); **h5** is Sans 600, 14/22, in ink. A
heading is never `--ink-muted`, and never smaller than the prose it introduces — a section title set in muted meta
above full-size body reads as a caption for the paragraph rather than a heading over it. The rung below h5 is not a
heading at all but a bold-body paragraph (Sans 500, 14/22, ink). Components whose heading style is fixed — `Panel`,
`EmptyState`, `ErrorState`, `IllustrativeSample` — keep taking a `headingLevel` for the document outline and keep
their own style; this rule governs prose headings written inside a section.

### Named Rules

**The Tabular Clock Rule.** Anything that counts (the clock, word counts, confidence) uses Mono with tabular figures so digits never shift.

**The Reading Measure Rule.** Student writing surfaces use 16/26 Sans at a 72ch maximum; UI chrome stays at 14/22.

## Layout

- Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64 px (`--space-1` … `--space-8`). In Tailwind classes these are `p-1`, `p-2`, `p-3`, `p-4`, `p-6`, `p-8`, `p-12`, `p-16` on the default 4 px scale, which is never remapped. Page gutter 24 px at `md` and above (16 px under it); panel padding 16 px; dense table cells 8 px.
- Breakpoints: `sm` 640, `md` 768, `lg` 1024, `xl` 1280. The app shell is a 56 px header, a 224 px left rail, and `main` at `md` and above; under `md` the rail becomes a fixed bottom bar and `main` keeps 80 px clear beneath its content for it. The run workspace is three columns at `lg` (Evidence Room | assistant and claims | brief and log), two at `md` with tabs, one under `md` with a bottom tab bar.
- Density: matrix and timeline at 12/18 Mono with 8 px cells and a sticky first column when scrolling horizontally; writing surfaces at 16/26 with 24 px padding.
- Minimum touch target 40 px; nothing requires hover; every action is reachable by keyboard and tap.
- Sections are separated by whitespace and hairlines, never by nested containers.

## Elevation & Depth

Flat by default. Panels sit on `--paper` with a 1 px `--line` border and no shadow; the raised paper color is the only "lift". The floating layer (dialogs, popovers, sheets, menus, tooltips, toasts) is the one exception and uses a single ambient shadow.

### Shadow Vocabulary

- **Float** (`box-shadow: 0 8px 24px rgb(20 26 38 / 0.12)`): dialogs, alert dialogs, popovers, dropdown and select menus, sheets, tooltips, and toasts. Nothing else casts a shadow.

### Named Rules

**The One-Layer Rule.** Cards are never nested inside cards. A panel contains sections, not other panels; a second level of grouping is whitespace plus a hairline or an `h4`.

## Shapes

- Radius 2 px (`--radius-sm`) for chips, badges, and table cells; 6 px (`--radius-md`) for inputs, buttons, panels, and menus; 10 px (`--radius-lg`) for dialogs; sheets are edge-anchored and square.
- Pill buttons (radius 999 px) exist only for stance chips; round geometry elsewhere is limited to the switch and progress tracks, the radio, and the scrollbar thumb.
- Borders are 1 px hairlines. Illustrative-sample panels use a dashed 1 px `--line-strong` border; draft labels use a 2 px solid amber left border.
- Icons are `lucide-react` line icons at 16 px in chips and 20 px in navigation, stroke width default, always with a text label or `aria-label`.

## Components

Every component takes its strings from `t()`, is keyboard operable, and shows the focus ring (`2px solid --focus`, offset 2 px). shadcn/ui primitives are themed through the CSS variables in `src/app/globals.css`, never through zinc defaults.

**Focus recipe.** One recipe for every focusable element: `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus` (text inputs also turn their border `--primary`). No half-alpha glow rings, no `outline-none` without a replacement outline, and the recipe never sits on the same element as `outline-none` or `outline-hidden`: Tailwind 4 compiles `outline-none` to `--tw-outline-style: none`, which `focus-visible:outline-2` then reads back, so the ring silently disappears (D-158). Containers that only receive programmatic focus (`main`, dialog popups) may carry `outline-none` alone.

**Control heights.** Buttons, inputs, selects, tab triggers, menu items, and toggle rows are 40 px tall (sm buttons 32 px). Popups: 6 px radius, 1 px `--line` border, `--shadow-float`, 200 ms `--ease-out`; dialogs 10 px radius and sheets square; scrims are `--ink` at 10 %.

### Buttons

- **Shape:** 6 px radius, 40 px tall (`sm` 32 px, `lg` 48 px; `icon` and `icon-sm` are 40 px and 32 px squares), 16 px horizontal padding (`sm` 12 px, `lg` 20 px) with the height carrying the vertical rhythm, label type 13/20 weight 500 (`lg` steps up to 14/22).
- **Primary:** `--primary` fill, `--primary-ink` text. **Hover:** fill darkens by mixing 10 % ink; **Active:** 15 %. **Focus:** the focus ring; no glow.
- **Secondary** (`outline` is the alias other primitives pass): `--paper-raised` fill, `--line-control` border, `--primary` text, `--paper-sunken` on hover. **Ghost:** transparent, `--ink` text, `--paper-sunken` on hover. **Destructive:** `--red` fill, white text, the same 10 % and 15 % ink mix on hover and active. **Link:** `--primary` text with no height or padding, underlined on hover.
- **Disabled:** the whole control at 45 % opacity (`disabled` and `aria-disabled` alike), using `aria-disabled` where the control must stay discoverable (the lock button while a claim is unstanced announces the reason).

### Chips

- **Label chips** (`draft`, `confirmed`, `uncalibrated`, `walkthrough`, `provisional`, `unreviewed`, `sample`, `warning`, `planted`): 2 px radius, 13/20 weight 500 ink text, a soft fill (`--amber-soft`, `--green-soft`, `--primary-soft`, `--paper-sunken`, and `--red-soft` for `planted` alone — the one label that names something an author placed for a student to find), a 2 px left border and a 16 px icon in the strong color.
- **Stance chips:** pill, 40 px tall, `--paper-raised` fill with a hairline border at rest; when selected the fill is the stance color's wash and the border and icon are the stance color; the text stays ink. Five chips behave as a radio group.
- **Badge** (shadcn primitive): the same shape as a label chip (24 px tall, 2 px radius, 13/20 weight 500, soft fill with the strong color for text or border, no glow); product labels use `LabelChip`, Badge is for counts and ad-hoc tags.

### Panels

- **Corner Style:** 6 px. **Background:** `--paper-raised`. **Border:** 1 px `--line`. **Shadow Strategy:** none. **Internal Padding:** 16 px (24 px for writing surfaces). A panel has an optional title row in the Title style (an `h2` by default; `headingLevel` picks the element), an optional `--ink-muted` description, and actions on the right. Panels are never nested.

### Inputs / Fields

- **Style:** `--paper-raised` fill, 1 px `--line-control` border, 6 px radius, 40 px tall, 14/22 ink text; textareas for writing use 16/26.
- **Focus:** border becomes `--primary` and the focus ring shows; no glow. **Error:** border `--red`, message in `--red` 13/20 beneath with an icon. **Disabled:** ink at 45 % alpha, `--paper-sunken` fill.
- **Placeholder:** ink at 70 % alpha, never the only label.
- **Toggles (checkbox, radio, switch):** Base UI renders the role on a `span` and links it to the `FieldLabel` whose `htmlFor` matches the control `id`, but only after hydration. Give the label an `id` and set `aria-labelledby` on the toggle so the accessible name is already in the server HTML; a toggle without a visible label carries `aria-label`. Labels stay visible. The same rule applies to every Base UI part that names another (`ProgressLabel` for `Progress`).

### Navigation

- The rail is a `nav` with `aria-current="page"`, 20 px icons with visible labels, 40 px rows (icon beside label) on a 224 px rail, `--paper-sunken` on hover, `--primary-soft` fill and `--primary` text for the active item. Under `md` it becomes a fixed bottom bar of 48 px cells (icon over label) with the same items. A skip link to `main` is the first focusable element and shows, when focused, as a 40 px raised-paper button with a hairline border at the top-left.
- **Header:** 56 px, raised paper with a hairline bottom edge: the brand in Serif 600 at the h4 size, a vertical hairline, the institution switcher (plain text for one institution, a ghost button opening a radio menu for several), the notifications bell (40 px icon button with a Mono count badge in `--primary`, capped at 99+), and the account menu (ghost icon button opening a 256 px dropdown).

### Empty and error states

- **Empty state:** one serif heading (the Title style when it is the panel's only heading, the Subtitle style beneath a panel title so two Title lines never sit in one panel), one sentence of body text, one action, inside the panel where content will appear. No illustration.
- **Error state:** the plain message, the request id in Mono, a "Try again" action.
- **Illustrative sample:** a panel with a dashed `--line-strong` border whose header carries the amber "Illustrative sample data" label chip; it never renders without the label.

### Overlays, tabs, tables, and feedback

- **Menus and popovers:** raised paper, 1 px `--line` border, 6 px radius, `--shadow-float`, 200 ms `--ease-out`; menu rows 40 px with a `--paper-sunken` highlight (select options highlight in `--primary-soft` with `--primary` text) and the focus recipe inset; a menu is at least as wide as its anchor and never wider than 384 px or the viewport minus 32 px, a select popup matches its anchor’s width, and a popover is 288 px.
- **Dialogs and sheets:** dialogs take the 10 px radius and edge-anchored sheets stay square; raised paper, `--shadow-float`, serif title in the h4 size, body text in `--ink-muted`; the scrim is `--ink` at 10 %.
- **Tooltip:** `--ink` fill, `--paper` text, 13/20, 2 px radius, 150 ms fade; the popup has `role="tooltip"` and the trigger points at it with `aria-describedby`.
- **Toast:** Plex Sans on raised paper with `--shadow-float`, title in ink, description in `--ink-muted`; the region is labelled "Messages".
- **Tabs:** a `--paper-sunken` list with 40 px triggers in 13/20 weight 500; the active trigger is raised paper with a hairline, no shadow. A `line` variant drops the well and marks the active trigger with a 2 px `--primary` underline.
- **Tables:** 13/20 head, 14/22 cells, numbers in Mono; the scroll container is a focusable `region` named by the caption; captions stay one short line (a long caption inherits the table width and clips at 360 px), provenance notes go in a paragraph below the table; rows have no hover wash unless they are interactive.

### The clock

- Mono, tabular, updated once per second without animation; paused state shows the pause icon and the cause; live-region announcements at 5:00 and 1:00.

## Do's and Don'ts

### Do:

- **Do** use the token variables (`--paper`, `--ink`, `--primary` …) and the Tailwind color names that map to them; never a raw hex in a component.
- **Do** keep one accent per screen: teal for the action the visitor is there to take.
- **Do** pair every stance and semantic color with a text label and an icon.
- **Do** separate sections with whitespace and hairlines; one panel level only.
- **Do** keep motion at 150 ms (state) and 200 ms (panels) with `cubic-bezier(0.2, 0, 0, 1)`, and remove it under `prefers-reduced-motion`.
- **Do** put numbers in Mono with tabular figures.
- **Do** write empty states as heading, sentence, action.

### Don't:

- **Don't** use Inter, Arial, or a system default as the primary face.
- **Don't** put gray text on a colored background, or amber text anywhere.
- **Don't** use pure black (`#000`) or pure gray; ink and paper are tinted.
- **Don't** nest cards inside cards.
- **Don't** use bounce or elastic easing.
- **Don't** use gradients, illustrations, or raster images.
- **Don't** rely on hover: every action is reachable by tap and keyboard.

## Motion

- Durations: `--dur-fast` 150 ms for state changes (hover, selection, chip fill), `--dur-base` 200 ms for panel, sheet, dialog, and menu open/close.
- Easing: `--ease-out` `cubic-bezier(0.2, 0, 0, 1)` everywhere; no bounce, no elastic, no spring.
- `prefers-reduced-motion: reduce` sets every transition and animation duration to 0.
- The clock updates once per second with no animation; streaming assistant text appends without fades.
