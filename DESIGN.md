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
  line-control: 'rgb(20 26 38 / 0.4)'
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
    padding: '8px 16px'
    height: '40px'
  button-secondary:
    backgroundColor: '{colors.paper-raised}'
    textColor: '{colors.primary}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    padding: '8px 16px'
    height: '40px'
  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    padding: '8px 12px'
    height: '40px'
  button-destructive:
    backgroundColor: '{colors.red}'
    textColor: '{colors.primary-ink}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    padding: '8px 16px'
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
    padding: '2px 8px'
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

| Token                | Value                 | Use                                                                                                         |
| -------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `--paper`            | `#F6F7F9`             | page ground                                                                                                 |
| `--paper-raised`     | `#FFFFFF`             | panels, cards (never nested)                                                                                |
| `--paper-sunken`     | `#ECEFF3`             | inputs, timeline track                                                                                      |
| `--ink`              | `#141A26`             | primary text (tinted, never pure black)                                                                     |
| `--ink-muted`        | `#4B5563`             | secondary text (7.0:1 on paper)                                                                             |
| `--ink-faint`        | `#8A93A3`             | decorative only: gridlines, disabled outlines, hairline icons; never text (3.1:1 on paper-raised, D-153)    |
| `--line`             | `#D5DAE2`             | hairline borders, panel edges, table rules                                                                  |
| `--line-strong`      | `#AEB6C2`             | dashed illustrative-sample borders, emphasized rules                                                        |
| `--line-control`     | `rgb(20 26 38 / 0.4)` | input and control boundaries (3.9:1 on paper, 16 §8.7)                                                      |
| `--primary`          | `#0F6E74`             | actions, links, selected stance (deep teal; 5.59:1 on paper)                                                |
| `--primary-ink`      | `#FFFFFF`             | text on primary (6.0:1)                                                                                     |
| `--primary-soft`     | `#DDEFF0`             | selected row background; text on it is `--primary` or `--ink`                                               |
| `--amber`            | `#B7791F`             | draft, uncalibrated, provisional: borders, icons, and chip fills only; never a text color (3.40:1 on paper) |
| `--amber-soft`       | `#FBF1DC`             | label chip background with `--ink` text                                                                     |
| `--red`              | `#A23B2A`             | refusals, errors, defect rows in the replay (6.13:1 on paper)                                               |
| `--red-soft`         | `#F8E5E1`             | error surfaces; text on it is `--red` or `--ink`                                                            |
| `--green`            | `#2E7D4F`             | confirmed, matched stances (4.71:1 on paper)                                                                |
| `--green-soft`       | `#E1F1E7`             | confirmation surfaces; text on it is `--ink`, the green is the icon                                         |
| `--focus`            | `#0F6E74`             | 2 px outline with 2 px offset on every focusable element                                                    |
| `--stance-accept`    | `#2E7D4F`             | stance chip and matrix cell: accept                                                                         |
| `--stance-verify`    | `#0F6E74`             | stance chip and matrix cell: verify                                                                         |
| `--stance-challenge` | `#B7791F`             | stance chip and matrix cell: challenge                                                                      |
| `--stance-reject`    | `#A23B2A`             | stance chip and matrix cell: reject                                                                         |
| `--stance-escalate`  | `#5B4B9A`             | stance chip and matrix cell: escalate                                                                       |

### Primary

- **Deep Teal** (`#0F6E74`): every action, link, selected state, and the focus ring. It is the one voice on a screen; it is not used for decoration.

### Neutral

- **Cool Paper** (`#F6F7F9`): the page ground. **Raised Paper** (`#FFFFFF`): panels, dialogs, inputs. **Sunken Paper** (`#ECEFF3`): input wells and the timeline track.
- **Tinted Ink** (`#141A26`): all primary text. **Muted Ink** (`#4B5563`): secondary text and metadata. **Faint Ink** (`#8A93A3`): decorative strokes only.
- **Hairline** (`#D5DAE2`) and **Strong Hairline** (`#AEB6C2`): borders and rules. Control boundaries use ink at 40 % alpha so they reach 3:1.

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

**Display Font:** IBM Plex Serif (with Georgia, Times New Roman fallback), weights 500 and 600.
**Body Font:** IBM Plex Sans (with system-ui, Segoe UI, Helvetica Neue, Arial fallback), weights 400, 500, 600.
**Label/Mono Font:** IBM Plex Mono (with ui-monospace, Menlo, Consolas fallback), weights 400 and 500, `font-feature-settings: "tnum" 1`.

All faces are self-hosted woff2 in `public/fonts/` and loaded through `next/font/local` (`src/app/fonts.ts`); only the Sans faces are preloaded. No italic faces ship: `<em>` renders at weight 500, `<strong>` at 600, and the browser never synthesizes an oblique. Never Inter, Arial, or a system default as the primary face.

**Character:** a technical serif over a humanist grotesque, with a monospace for anything the instrument measures. Headings read like a report; the UI reads like a control surface; numbers line up.

### Hierarchy

- **Display / h1** (Serif 600, 36px, 44px): page titles in `PageHeader`.
- **Headline / h2** (Serif 500, 30px, 38px): section titles.
- **Title / h3** (Serif 500, 24px, 32px): panel titles and empty-state headings.
- **Subtitle / h4** (Serif 500, 20px, 28px): sub-sections inside a panel.
- **Lead** (Sans 400, 18px, 28px): the scenario brief's opening.
- **Reading** (Sans 400, 16px, 26px): everything the student writes and reads at length (frame, brief, documents, defense); max measure 72ch.
- **Body** (Sans 400, 14px, 22px): the default UI size.
- **Label / meta** (Sans 500, 13px, 20px): buttons, chips, table headers, metadata; sentence case, never uppercase tracking.
- **Mono** (Mono 400/500, 14px, 20px) and **Mono dense** (12px, 18px): trace data, keys, request ids, the clock, matrix cells and timeline labels.

### Named Rules

**The Tabular Clock Rule.** Anything that counts (the clock, word counts, confidence) uses Mono with tabular figures so digits never shift.

**The Reading Measure Rule.** Student writing surfaces use 16/26 Sans at a 72ch maximum; UI chrome stays at 14/22.

## Layout

- Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64 px (`--space-1` … `--space-8`). In Tailwind classes these are `p-1`, `p-2`, `p-3`, `p-4`, `p-6`, `p-8`, `p-12`, `p-16` on the default 4 px scale, which is never remapped. Page gutter 24 px; panel padding 16 px; dense table cells 8 px.
- Breakpoints: `sm` 640, `md` 768, `lg` 1024, `xl` 1280. The app shell is a left rail plus `main` at `md` and above; under `md` the rail becomes a bottom bar. The run workspace is three columns at `lg` (Evidence Room | assistant and claims | brief and log), two at `md` with tabs, one under `md` with a bottom tab bar.
- Density: matrix and timeline at 12/18 Mono with 8 px cells and a sticky first column when scrolling horizontally; writing surfaces at 16/26 with 24 px padding.
- Minimum touch target 40 px; nothing requires hover; every action is reachable by keyboard and tap.
- Sections are separated by whitespace and hairlines, never by nested containers.

## Elevation & Depth

Flat by default. Panels sit on `--paper` with a 1 px `--line` border and no shadow; the raised paper color is the only "lift". The floating layer (dialogs, popovers, sheets, menus) is the one exception and uses a single ambient shadow.

### Shadow Vocabulary

- **Float** (`box-shadow: 0 8px 24px rgb(20 26 38 / 0.12)`): dialogs, alert dialogs, popovers, dropdown menus, sheets. Nothing else casts a shadow.

### Named Rules

**The One-Layer Rule.** Cards are never nested inside cards. A panel contains sections, not other panels; a second level of grouping is whitespace plus a hairline or an `h4`.

## Shapes

- Radius 2 px (`--radius-sm`) for chips, badges, and table cells; 6 px (`--radius-md`) for inputs, buttons, panels, and menus; 10 px (`--radius-lg`) for dialogs and sheets.
- Pill shapes (radius 999 px) exist only for stance chips.
- Borders are 1 px hairlines. Illustrative-sample panels use a dashed 1 px `--line-strong` border; draft labels use a 2 px solid amber left border.
- Icons are `lucide-react` line icons at 16 px in chips and 20 px in navigation, stroke width default, always with a text label or `aria-label`.

## Components

Every component takes its strings from `t()`, is keyboard operable, and shows the focus ring (`2px solid --focus`, offset 2 px). shadcn/ui primitives are themed through the CSS variables in `src/app/globals.css`, never through zinc defaults.

### Buttons

- **Shape:** 6 px radius, 40 px tall (`sm` 32 px, `lg` 48 px), 8 px × 16 px padding, label type 13/20 weight 500.
- **Primary:** `--primary` fill, `--primary-ink` text. **Hover:** fill darkens by mixing 10 % ink; **Active:** 15 %. **Focus:** the focus ring; no glow.
- **Secondary:** `--paper-raised` fill, `--line-control` border, `--primary` text. **Ghost:** transparent, `--ink` text, `--paper-sunken` on hover. **Destructive:** `--red` fill, white text.
- **Disabled:** ink at 45 % alpha on paper with `aria-disabled` where the control must stay discoverable (the lock button while a claim is unstanced announces the reason).

### Chips

- **Label chips** (`draft`, `confirmed`, `uncalibrated`, `walkthrough`, `provisional`, `unreviewed`): 2 px radius, 13/20 weight 500 ink text, a soft fill (`--amber-soft`, `--green-soft`, `--primary-soft`, `--paper-sunken`) and an icon in the strong color.
- **Stance chips:** pill, 40 px tall, `--paper-raised` fill with a hairline border at rest; when selected the fill is the stance color's wash and the border and icon are the stance color; the text stays ink. Five chips behave as a radio group.

### Panels

- **Corner Style:** 6 px. **Background:** `--paper-raised`. **Border:** 1 px `--line`. **Shadow Strategy:** none. **Internal Padding:** 16 px (24 px for writing surfaces). A panel has an optional serif `h3` title row with actions on the right. Panels are never nested.

### Inputs / Fields

- **Style:** `--paper-raised` fill, 1 px `--line-control` border, 6 px radius, 40 px tall, 14/22 ink text; textareas for writing use 16/26.
- **Focus:** border becomes `--primary` and the focus ring shows; no glow. **Error:** border `--red`, message in `--red` 13/20 beneath with an icon. **Disabled:** ink at 45 % alpha, `--paper-sunken` fill.
- **Placeholder:** ink at 70 % alpha, never the only label.
- **Toggles (checkbox, radio, switch):** Base UI renders the role on a `span`, so a label's `htmlFor` does not name it; every toggle carries `aria-labelledby` pointing at its `FieldLabel` id (or `aria-label`), and the label stays visible.

### Navigation

- The rail is a `nav` with `aria-current="page"`, 20 px icons with visible labels, 40 px items, `--primary-soft` fill and `--primary` text for the active item. Under `md` it becomes a bottom bar with the same items. A skip link to `main` is the first focusable element.

### Empty and error states

- **Empty state:** one serif `h3`, one sentence of body text, one action, inside the panel where content will appear. No illustration.
- **Error state:** the plain message, the request id in Mono, a "Try again" action.
- **Illustrative sample:** a panel with a dashed `--line-strong` border whose header carries the amber "Illustrative sample data" label chip; it never renders without the label.

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
