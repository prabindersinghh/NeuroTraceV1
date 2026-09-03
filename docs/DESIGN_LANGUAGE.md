# Design Language

*What this product looks and feels like — the principles, tokens, components, and copy that make a worker-first, mobile-first operations UI read as one system. Self-contained and portable: fill the brand token block for a new project and everything downstream re-themes. Extracted from a real production factory-ERP frontend; every value below is the one that actually shipped, and where the build deviates from its own standard it is flagged as a known gap rather than idealized.*

Its companion, **FRONTEND_ENGINEERING.md**, covers how it is built to this standard.

> **How to adopt the brand:** exactly one block below (§2.0 *Brand tokens*) is project-specific — the raw brand hues and the logo mark. Replace those, and the entire palette, components, and charts inherit the new identity. Everything else in this document is brand-neutral system.

---

## 1. Design philosophy

The principles that actually governed this build — not aspirations, the rules the screens obey:

1. **Worker-first, not office-first.** The primary user is on a factory floor, on a phone, possibly gloved, in bad light. Big touch targets, few words, one obvious next step per screen, and nothing that can be broken by a wrong tap. *(Reference code says it out loud: "built for a factory-floor worker, not an office user… big touch targets; few words.")*
2. **Mobile-first, degrade up to desktop.** Layouts are designed for a narrow screen and a thumb; desktop is the wide case, not the base case.
3. **One screen = one job.** Most roles have a single screen. A screen does one thing well rather than five things adequately; extra capability goes to another role, not another panel.
4. **Status is always visible.** Running totals, a live count, a progress bar, or a coloured state pill is on screen during every task — the worker never wonders "did that work?" or "how far am I?"
5. **Plain operational language over jargon.** Buttons are verbs, numbers lead, and errors say what to do — never a code, never a stack of nouns. The vocabulary is the factory's, not the database's.
6. **The system is honest.** A progress bar never claims done before it is; a number the client can't trust it doesn't compute; a feature that's degraded says so and offers the manual path.
7. **Physicality is the premium cue.** Everything clickable gives weight back (a press-scale, a spring release); motion has easing, never linear; but movement is disciplined and collapses entirely under reduced-motion.

---

## 2. Tokens

The whole product reads from CSS custom properties (bare HSL triplets, so Tailwind can wrap them as `hsl(var(--token))` and do `hsl(var(--x) / 0.5)` for alpha). One file is the single source of truth; Tailwind, components, and charts all consume it.

### 2.0 Brand tokens — **replace per brand** (the only project-specific block)

```css
/* BRAND — the raw identity hues. The reference values are a paint brand's
   logo colours; SWAP THESE for the new project, then never use them directly
   in components — always via the semantic tokens below, so a rebrand is a
   one-line change. */
--brand-red:    0 99% 46%;   /* primary brand hue (reference: #EB0102) */
--brand-yellow: 56 99% 51%;  /* secondary          (reference: #FEEF03) */
--brand-violet: 279 98% 40%; /* tertiary/accent    (reference: #8802C9) */
--brand-amber:  38 95% 50%;  /* the readable warm partner to a hot yellow */
```

The **logo mark** is the other brand-specific asset. In the reference it's an inline SVG (three overlapping strokes), drawn geometrically so it holds shape down to ~16px and can animate per-part — not a raster `<img>`. Replace the mark; keep the lockup component (mark + wordmark, `tone: 'ink' | 'light'`, an optional small-caps subtitle line for the current role/context).

### 2.1 Colour — semantic roles (values shown are the reference; roles are fixed)

Every colour has a **role**, and components reference the role, never a raw hue. A key deliberate decision: **the brand's loudest colour is NOT the default action colour.** Using brand-red for every button made ordinary actions look like alarms and collided with the danger state; so *primary* is a warm near-black ink, and red is reserved for the mark, the active-nav rail, focus rings, and genuine danger.

```css
:root {
  /* Warm neutral ramp — the "paper stock" greys (biased toward the brand hue so
     white space reads as chosen paper, not default screen-grey). Replace the hue
     bias per brand; keep the 50→950 ramp. */
  --paper: 32 40% 98.5%;                 /* app canvas */
  --chip-50: 32 34% 97%;   --chip-100: 30 28% 94%;  --chip-200: 28 22% 88%;
  --chip-300: 26 17% 79%;  --chip-400: 24 13% 62%;  --chip-500: 24 12% 41%;
  --chip-600: 24 13% 35%;  --chip-700: 24 16% 25%;  --chip-800: 24 20% 16%;
  --chip-900: 26 26% 11%;  --chip-950: 26 32% 7%;

  /* Surfaces & text hierarchy */
  --background: var(--paper);            --foreground: var(--chip-900);   /* body text */
  --card: 0 0% 100%;                     --card-foreground: var(--chip-900);
  --muted: var(--chip-100);              --muted-foreground: var(--chip-500); /* secondary text */
  --border: var(--chip-200);             --input: var(--chip-300);
  --ring: var(--brand-red);              /* focus ring = brand hue */

  /* PRIMARY = warm ink (default actions, headings) — deliberately NOT brand-red */
  --primary: 24 22% 14%;                 --primary-foreground: 32 34% 97%;
  /* ACCENT-BRAND = the brand shout, for active states/highlights ONLY */
  --accent-brand: var(--brand-red);      --accent-brand-foreground: 0 0% 100%;

  /* Sidebar/chrome — deep ink so a coloured mark + red active state sing on it */
  --sidebar-background: var(--chip-950); --sidebar-foreground: 30 15% 82%;

  /* SEVERITY — the operational alert language. Four levels, separated by HUE
     (not just lightness) so they read under bad light and survive colour-blindness
     when paired with the icon+label the components always render. Each ships a
     solid, a foreground, a tinted surface, and a border, so an alert never needs a
     one-off colour. */
  --critical: 0 84% 45%;  --critical-foreground: 0 0% 100%;
  --critical-surface: 0 86% 97%;  --critical-border: 0 80% 88%;   /* act now */
  --warning: var(--brand-amber);  --warning-foreground: 30 90% 12%;
  --warning-surface: 42 96% 95%;  --warning-border: 40 90% 82%;   /* attention */
  --healthy: 152 66% 27%;  --healthy-foreground: 0 0% 100%;
  --healthy-surface: 150 60% 96%; --healthy-border: 150 45% 84%;  /* all good */
  --info: 214 84% 46%;    --info-foreground: 0 0% 100%;
  --info-surface: 214 90% 97%;    --info-border: 214 75% 88%;     /* neutral info */
  --destructive: 0 84% 47%;       --destructive-foreground: 0 0% 100%;

  /* CHARTS — categorical ramp leads with the brand's own hues so a chart looks
     unmistakably like this company's chart; movement colours keep fixed MEANING. */
  --chart-add: 152 62% 38%;  --chart-deduct: 214 84% 50%;  --chart-discard: 0 84% 52%;
  --chart-1: var(--brand-red); --chart-2: var(--brand-amber); --chart-3: var(--brand-violet);
  --chart-4: 152 62% 38%; --chart-5: 214 84% 50%; --chart-6: 330 72% 51%;
  --chart-grid: 26 15% 90%;  --chart-axis: 22 10% 55%;
}
```

**Role summary:** `primary` = default actions + headings (warm ink) · `accent-brand` = brand emphasis / active only · `healthy` = success/confirm/in-stock · `warning` = attention/ageing/provisional · `critical` = act-now/blocked · `info` = neutral context · `destructive` = irreversible danger · `chip-50…950` = surfaces & text hierarchy · `muted-foreground` = secondary text.

> **Known gap:** legacy aliases `--success`/`--success-foreground` still point at `--healthy`, and a few components still emit `text-success-foreground` or raw shadcn defaults (`bg-background`, `shadow-sm`, `text-muted-foreground`) instead of the severity/chip vocabulary. New work should use the severity + chip tokens directly; the aliases exist only so older callers didn't have to change.

### 2.2 Typography

- **One self-hosted variable face** (reference: Inter var via `@fontsource-variable`), stack `['Inter var','Inter','system-ui','sans-serif']`. **Never a font CDN link** — it fails silently under a strict CSP and drops to system-ui with no error.
- **A type scale with line-height + tracking baked in**, so headings stay consistent without per-callsite tuning:

| Token | Size / line-height / weight / tracking | Used for |
|---|---|---|
| `text-display` | 2.75rem / 1.05 / 800 / -0.03em | hero numbers, splash |
| `text-title-1` | 2rem / 1.15 / 700 | page titles |
| `text-title-2` | 1.5rem / 1.2 / 700 | section titles |
| `text-title-3` | 1.125rem / 1.3 / 600 | card titles, dialog titles |
| `text-metric` | 2.25rem / 1 / 700 | the big KPI number |
| `text-label` | 0.6875rem / 1.2 / 600 / **+0.08em, uppercase** | micro-labels above metrics |
| body | 0.875rem (`text-sm`) default | everything else |

Base rules: headings get slightly tighter tracking (`-0.018em`); data contexts (`th, td, .tabular`) use `font-variant-numeric: tabular-nums` so numbers never shift width as they change or count up.

### 2.3 Spacing, radii, shadows, borders, motion

- **Spacing:** Tailwind's default 4px scale, used through layout (`gap`, flex/grid) rather than per-element margins. Card padding is `p-4`; touch rows breathe more.
- **Radii:** `--radius: 0.625rem` (10px base) · `sm 0.375rem` · `lg 0.875rem` · `xl 1.25rem`. Cards are `rounded-lg`, pills `rounded-full`, inputs/buttons `rounded-md`.
- **Elevation — five warm-tinted layers** (shadow colour is a warm ink `24 30% 12%`, never pure black, so cards feel like *paper on paper*): `--elev-1`…`--elev-5` → utilities `.elev-1`…`.elev-5` / `shadow-elev-*`. Cards rest at `elev-1`, lift to `elev-3` on hover, dialogs sit at `elev-5`. Plus a brand-red focus/press glow.
- **Borders:** hairline `--border` (`chip-200`); inputs `--input` (`chip-300`); severity surfaces each carry their own `-border`.
- **Motion — one easing + duration vocabulary** (nothing linear): eases `--ease-out` (entrances), `--ease-in-out` (state moves), `--ease-spring` (press overshoot), `--ease-exit`; durations `--dur-instant 90ms` (press) · `fast 150ms` · `base 240ms` · `slow 380ms` (routes) · `deliberate 640ms` (celebratory: scan success). All transforms are GPU-friendly (`transform`/`opacity` only), and **everything collapses to a near-instant fade under `prefers-reduced-motion`** (an `animate-in … both` element must never be left stuck invisible).

---

## 3. Component vocabulary

Built on the **shadcn/ui** pattern (Radix + hand-vendored markup) so every component can be bent to worker-first sizing. Variants are named by *role*, never by colour.

### Buttons
`cva`-based; the base carries `.tactile` (press-scale + spring). Variants: `default` (primary ink), `destructive`, `outline`, `secondary`, `ghost`, `link`, and **`healthy`** — the high-emphasis confirm colour for *positive irreversible* actions (issue stock, confirm output, dispatch). Sizes give **touch devices a 44px minimum** while pointer devices keep compact sizing:
```
default: 'h-9 px-4 py-2 [@media(pointer:coarse)]:min-h-11'   // 44px on a phone
```
*Usage:* one clear primary action per screen; make it the `healthy` variant when it commits work, `destructive` when it removes it. On worker screens the primary action is often a full-width `h-14`/`h-16` tile.

### Cards (entity cards + the paint-chip edge)
`Card` is prop-driven: `interactive` adds `tactile-lift` (hover raises to `elev-3`); `edge='critical'|'warning'|'healthy'|'info'|'primary'` bonds a **4px colour swatch to the left edge** (the signature "paint-chip" shape, via the `.chip-edge` utility + `--chip-edge-color`). Base: `rounded-lg border bg-card shadow-elev-1`. Sub-parts `CardHeader/Title/Content`. *Usage:* the default container for one entity or one job; use `edge` to carry a severity without a separate badge.

### Progress / batch cards — the 0–100% bar
A repeated inline shape (not a shared component): a track `overflow-hidden rounded-full bg-chip-100` + an inner fill `h-full rounded-full bg-<severity>` with `style={{ width: \`${pct}%\` }}`, transitioning width. Fill colour can encode state (e.g. `bg-critical` under minimum, `bg-warning` below 40%, else `bg-healthy`). The bar is always paired with the **number and the percent in text** (`"12 of 40 dispatched · 30%"`) so it's never colour-only.
```html
<div class="h-2 w-full overflow-hidden rounded-full bg-chip-100"
     role="progressbar" aria-valuenow="30" aria-valuemin="0" aria-valuemax="100">
  <div class="h-full rounded-full bg-healthy" style="width:30%"></div>
</div>
```
> **Known gap:** the completion bars (batch/dispatch/stock) carry `role="progressbar"` + `aria-value*`; the dashboard/packing/label bars are bare `<div>`s. There is **no shared `<ProgressBar>` component** — the markup is copy-pasted, so accessibility drifts. If adopting: make one component with the ARIA baked in.

### Status badges + the severity language
Two idioms coexist:
- **`Badge`** — generic label chip, `variant` role union (`healthy|warning|critical|info|brand|secondary|outline|…`).
- **`SeverityBadge` / `SeverityAlert`** — the operational alert language, and the pattern worth standardizing on. Both **always render an icon** (`AlertOctagon`/`AlertTriangle`/`CheckCircle2`/`Info`) so **state is never carried by colour alone**; `SeverityAlert` is the full-width paint-chip row with `role={critical ? 'alert' : 'status'}` and an optional `pulse` (a slow *breathe*, reserved for genuinely blocking states — it catches peripheral vision without turning the screen into an alarm panel). Shared helpers map data to severity once (`ageingSeverity(days)`, `stockSeverity(balance, threshold)`) so every screen shows the same colour for the same condition.

*Colour mapping (fixed):* `critical` red = act now (out of stock, blocked) · `warning` amber = attention (ageing, partial, provisional) · `healthy` green = all good (confirmed, dispatched) · `info` blue = neutral context, never an alarm.
> **Known gap:** page-level *status* maps (batch status, PO status, request status) are **decentralized** — each screen re-declares its own `Record<Status, {label, cls|variant}>`, and colour choices drift slightly between them. A shared status registry would remove the drift.

### Tables vs card-lists
**Card-lists are the default; tables are the exception.** Only dense back-office/data screens (a movement ledger, the catalogue, a PO list) use `<Table>` (wrapped in `overflow-auto` so it scrolls on a phone rather than squashing). Every operational floor screen renders **`Card`/chip-edge lists** with a staggered entrance. *Rule of thumb:* if a worker scans it on a phone, it's a card list; if an office user compares many rows of columns, it's a table.

### Banners (degradation / warning)
The recurring inline banner is a chip-edge warning strip: `chip-edge rounded-lg border border-warning-border bg-warning-surface … text-warning-foreground`, leading with the **number**, then what it means and what to do ("*N units in the factory with no pack weight — not counted in totals. Set the pack weight to unblock.*"). For a **dependency being down** (AI extraction, camera), the pattern is a **toast + a manual fallback path** ("*Invoice extraction unavailable — enter it manually below*"), so the task continues in a reduced mode.
> **Known gap:** there is no persistent app-wide "system degraded" banner; degradation is per-feature. If your product has a shared dependency (like document storage), consider one lightweight global banner in the refresh layer.

### Modals / detail views
`Dialog` (Radix) with a blurred `chip-950/60` overlay and `elev-5` content; `Modal` and `ConfirmationDialog` are thin app-level wrappers. *Usage:* confirm gates and focused detail; full screens for a worker's main job, dialogs for a decision *about* it.
> **Known gap:** both the wrappers *and* the raw primitives are used across the app (two entry points to the same UI). Pick one.

### KPI cards
One metric component for every dashboard: a chip-edge `tactile-lift` card with an **uppercase `text-label`**, a **`text-metric` number that counts up** (rAF ease-out, snaps to final under reduced-motion, tabular figures so it doesn't jitter), an `accent` colour, and a **trend chip whose colour reflects whether the metric moved the *right* way** (`trendIsGood`) — not merely up/down. Has an inline `loading` skeleton.

### Session start/stop controls
A dedicated bar for the scan loop (see §4): a **`Start session`** button when idle (with the last session's count: "*Last session: 42 scanned*"), and when live a **pulsing green dot + "Session live · N scanned"** with a **`Done`** button that closes with a summary toast.

### List + search, empty states, loading states
- **Search** = a `SearchBar` (icon-left `Input pl-9`); **filters** = a `FilterPanel` grid with a "Clear all".
- **Empty state** = `EmptyState`: a ringed icon on a chip surface, `text-title-3` title, one-line description, optional single outline-button action, gentle `fade-up`. Empty states also do **gating** work ("*QR labels appear once the invoice is confirmed*") rather than showing a broken screen.
- **Loading** = **shape-matched skeletons** (`SkeletonKpi/Table/Chart`, or layout-level `LoadingSkeleton variant='dashboard'|…`) that mirror the real content so nothing jumps when data lands; the shimmer is a transform-translated gradient (never repaints), all `aria-hidden`.
> **Known gap:** three overlapping skeleton systems exist (`ui/skeleton`, `common/LoadingSkeleton`, KPI's inline block). Consolidate to one.

### Preview / pre-generation gating
There is **no rotated "PREVIEW" watermark**. Instead, printable output (QR labels) is gated by **state + a lock**, honestly: before the "mint" the label screen is an empty-state ("*Not registered yet — labels appear once confirmed*"); generation is a staged **Generate → Save → Print** flow whose progress bar **holds at 90% until the real file lands** ("the bar never lies about being finished"); after the first print a **reprint-lock card** (`edge='warning'`) requires a reason + approval. The client lock is a courtesy — the server enforces it.

---

## 4. Interaction patterns

### The scan-session loop — Start → rapid scan → Done-with-summary
The defining pattern. A worker **starts a session** (a real server record — the server *refuses a scan with no open session*, so the session is the one source of truth), then scans in a tight loop designed so **nothing is typed or clicked between scans**: scan → a ~1.5s confirmation → the scanner auto-refocuses, ready for the next. It handles a WiFi/USB gun (a hidden auto-refocusing input) *and* the phone camera (which fully **unmounts** between scans to release the camera and save battery). Errors **don't stop the run** — they're logged into a running list of the last ~12 outcomes. **Done** closes the session with a **count summary** ("*42 scanned this session*"). Duplicate scans within ~1.2s are ignored.

> **Honest correction to a common assumption:** in the reference build the per-scan feedback is **visual only** — an expanding pulse-ring + the whole card flashing green/red + the live count updating (`aria-live="polite"`). **There is no audio beep and no haptic buzz** (verified: zero `AudioContext`/`navigator.vibrate` in the codebase). On a noisy floor this is a genuine gap; if you build this loop, add a short beep + a vibrate on success/reject — the visual language (`animate-pulse-ring` for success, `animate-shake` for reject) is already there to pair with. *(The `animate-shake` reject cue even exists but is currently only wired to the login form, not the scan reject path.)*

### Hard confirm gates before irreversible acts
Anything that can't be undone goes through a confirm gate that **states the consequence in plain words and names the audit trail**. Real examples:
- *"Scrap this unit? … will be written off permanently and leave inventory. … This is recorded in the audit trail." → "Scrap it"*
- *"Confirm and hand over to Store? This registers N unit codes … and hands the inward to Store. This cannot be undone." → "Confirm & hand over"*
- *"Dispatch the whole batch? This marks all N remaining units … as dispatched." → "Dispatch all"*

The confirm button is a **verb that restates the act** ("Scrap it", "Deactivate", "Confirm output"), never a bare "OK".
> **Known gap:** the gate isn't uniform — most use a shared `ConfirmationDialog`, one uses a bespoke full review sheet, and one destructive action (voiding a packed box) still uses a native `window.prompt`. Standardize on the styled dialog.

### Friendly, plain-words errors (never a code)
Errors tell the worker what happened and what to do, in their language:
- *"That drum is already in another box — remove it there first."*
- *"Start a session first on the Scan In tab."*
- *"Only 4 kg remain on MC-000123."* / *"Scanned Calcium Carbonate, but this line needs Titanium Dioxide."*
- *"MC-000123 belongs at Dispatch, not receiving."*
- network: *"Cannot reach the server. Please check your connection and try again."*

The pattern is a small `friendly(msg)` translator that maps known error shapes to plain sentences, with a safe fallback (*"Something went wrong. Please try again."*).
> **Known gap:** this translator exists on **only one screen**; most screens pass the raw backend message straight to the toast, and a few surface an HTTP status number or a raw `DOMException` name. **Centralize `friendly()`** into the API layer so every error is plain by default.

### Progress visibility
During any task, the count is on screen: running totals as number-first pills ("*3 combos · 5 singles · 2 drums left*"), a live "N scanned", a completion bar with its number + percent, a "*Scanning batch 7 — 4 of 12 done*" line. The worker never has to guess how far they are.

### Mistake-proofing — prefer undo-by-construction over edit-in-place
- **Tap-to-remove:** items added to a working set are chips with an `×` — one tap removes.
- **Void-and-redo, not edit:** a committed grouping (a packed box) is *voided* (its contents return to the pool to be re-done) rather than edited in place.
- **New record, not mutate:** a refurbished unit becomes a **new** tracked id with its own history, never an overwrite of the old one.
- **Wrong-context guards:** scanning the wrong kind of code is refused with a plain reason ("*is an inward unit, not finished goods*"), so cross-workflow mistakes can't commit.
- **Non-destructive Back:** a detail/scan screen owns the back gesture so Back closes *it* and returns to the loop, never dumps the worker out of the app mid-run.

---

## 5. UI copy rules

**Voice:** the factory's, not the database's. Calm, direct, second-person, present tense.

**Rules:**
1. **Verbs on buttons.** `Start session`, `Confirm & hand over`, `Dispatch all`, `Send alone`, `Print labels` — never `Submit`/`OK`.
2. **Numbers lead.** `42 scanned`, `12 of 40 dispatched`, `4 kg remain` — the number is the first thing read.
3. **Say what to do, not what failed.** Errors and empty states end with the next action ("*remove it there first*", "*Start a session first*", "*use Choose file instead*").
4. **Plain words over system nouns.** "box", "drum", "hand over to Store" — not "carton entity", "unit record", "commit transaction".
5. **No codes in front of a worker.** No HTTP statuses, no exception names, no enum values.
6. **Instructive disabled states.** A not-yet-usable button says *why* ("*Add at least 2 drums to make a box*") instead of being a silent grey.

**Ten real strings (why each works):**

| String | Why |
|---|---|
| `Start session` / `Done` | verb buttons, one loop everywhere |
| `Press Start, scan each drum, press Done. Same as everywhere.` | teaches the loop in one line |
| `Add at least 2 drums to make a box` | instructive disabled state |
| `Send alone` | plain verb, avoids "single carton" jargon |
| `Dispatch all 8` | verb + number baked into the label |
| `42 scanned` | number-first status |
| `Nothing waiting — everything produced has been dispatched.` | plain, reassuring empty state |
| `List confirmed — every label is ready.` | plain success, then one action |
| `Scan each sack in turn — no typing, no weighing.` | tells the worker what *not* to do |
| `Check the details below. Nothing is deducted until you confirm.` | reassurance before an irreversible act |

**Bilingual guidance (as practiced):** the **UI itself is single-language (English); there is no runtime i18n.** A **separate translated manual** (reference: Hindi) teaches the screens, and it **keeps the on-screen button words in English verbatim** — because that's exactly what the worker sees — while explaining the meaning in the local language, plus a glossary of the code prefixes. This is a deliberate, low-cost localization strategy for a workforce that operates an English UI: *translate the teaching, not the buttons.* (If you instead need a translated UI, add i18n from the start — retrofitting hard-coded literals is expensive.)

---

## 6. Accessibility & floor-proofing

- **44px+ touch targets on touch devices.** Buttons, inputs, and tabs all carry `[@media(pointer:coarse)]:min-h-11` (and worker primary actions are `h-14`/`h-16` full-width tiles), while pointer devices keep compact sizing. Verify on a real phone, not just a resized desktop.
- **Glove-and-sunlight legibility.** Severity is separated by **hue, not lightness**, so states read under glare and through a smudged screen; the big number uses `text-metric` at arm's-length size; surfaces are high-contrast paper-on-ink.
- **Colour is never the only signal.** Every severity pill/alert **pairs its colour with an icon and a label**; progress bars pair the fill with the number + percent in text; status uses a word, not just a swatch. *(Watch the gap: some page-level status chips lean on colour + label without an icon — prefer the `SeverityBadge` pattern that always includes one.)*
- **Keyboard focus is always visible.** A global `:focus-visible` brand-ring (2px + offset) is applied to every interactive element and appears for keyboard users but not on plain mouse clicks.
- **Phone-first, degrades to desktop.** Layouts stack on narrow screens (side-by-side only from `sm`/`lg` up); tables scroll inside their own container rather than breaking the page; the sidebar is an off-canvas drawer on mobile, a fixed rail on `lg+`.
- **Reduced motion is respected globally** — animations collapse to a near-instant fade (never left stuck invisible), continuous loops freeze, press-transforms disable. The KPI count-up snaps to its final value.
- **Poor-network / offline behaviour is designed, not assumed.** The API layer times out and retries only safe (connection-level) failures with a plain-language message; the few floor-critical actions (receiving scans) are **queued in IndexedDB and replayed idempotently** when the connection returns, with the queue state shown ("*Offline — will sync automatically*", "*Synced 3 queued scans*"). See FRONTEND_ENGINEERING.md §3–4.

---

*This document reflects the reference implementation as built, gaps included. Reproduce the strengths, and treat each "known gap" as a place to do better than the original — on purpose, and written down.*
