# NeuroTrace landing page — design specification

**Reference site:** [neuro-trace-v1.vercel.app](https://neuro-trace-v1.vercel.app/)
**Inspected:** 2026-08-31 at 1280 × 720 and 390 × 844
**Implementation:** `frontend/src/routes/Landing.tsx` and `frontend/src/components/landing/`
**Purpose:** Preserve the visual language, interaction model, responsive behavior, and
accessibility constraints of the public NeuroTrace landing page.
**Companion:** `docs/LANDING_CONTENT_SPEC.md` records the words on that page.

## 1. Design intent

The landing page is a clinical argument, not a feature catalogue. A visitor should be able
to restate its thesis after one pass:

> Recovery is mostly unmeasured between appointments. Population thresholds are unsuitable
> for a stroke survivor, so NeuroTrace compares each person with their own baseline and
> alerts only when a change persists, appears across independent domains, and has a side.

The page should feel calm, exact, and evidence-conscious. It uses editorial typography,
measured whitespace, restrained blue clinical surfaces, and dark instrument panels. It must
not look like a futuristic AI product, hospital alarm console, or generic SaaS dashboard.

## 2. Current deployment note

The deployed page and the checked-out branch have copy drift:

| Surface | Deployed site | Current branch |
|---|---|---|
| Session promise | “Three minutes a day” | ~~a ninety-second promise~~ **REJECTED, D-045** |
| HTML title | “a ~3-minute neurological exam” | ~~the same shortened figure~~ **REJECTED, D-045** |
| Hero safety lead-in | Emergency caveat only | ~~a regulatory-classification disclaimer~~ **REJECTED, D-042 / INV-13** |
| Footer | `engine deterministic · seed 42` | ~~the same disclaimer~~ **REJECTED, D-042 / INV-13** |

> **Four rows of this proposal did not survive integration, and the wording is not
> reproduced above on purpose.** Two claimed a ninety-second session: D-045 measured
> Daily Pulse at ~195s of raw task time, so that figure was corrected everywhere and a
> test now fails if any surface reintroduces it. The other two proposed a
> regulatory-classification disclaimer in the hero and footer. INV-13 permits no such
> claim anywhere in this repository — classification follows intended use, not a line of
> copy (D-042, `docs/INTENDED_USE.md`), and `test_regulatory_claims.py` scans tracked
> text for exactly this. Quoting the phrase, even to reject it, trips that scanner.

This file describes the shared design system. `content.md` records the live copy and the
copy changes requiring an owner decision. Do not allow a deployment to mix the two duration
promises.

## 3. Visual principles

1. **Light clinical canvas.** Patient/product surfaces stay white or pale blue for daylight
   legibility.
2. **Dark means instrument.** Near-black is reserved for traces, charts, and the limits
   chapter—not used as a second decorative theme.
3. **Status colors are semantic.** Blue is stable, amber is watch, red is alert, and violet
   is an atypical pattern. Never use these colors as decoration.
4. **No visual theatre.** No gradients, glassmorphism, decorative shadows, glowing text,
   stock clinical photography, or ornamental 3D.
5. **Show the reasoning.** The main visuals explain population versus personal baselines,
   laterality, the three gates, and the 21-day sequence.
6. **Claims carry their limits.** Synthetic/demo labels, emergency caveats, and product
   limitations remain visible in the page, not hidden in a footer or tooltip.

## 4. Design tokens

The implementation uses CSS custom properties in `frontend/src/index.css`.

| Token | Intended color | Use |
|---|---|---|
| `--background` | `#FFFFFF` | Primary page and card surface |
| `--foreground` | approximately `#15202D` | Main ink, primary buttons |
| `--primary` | `#1E5AA8` | Product blue where a primary token is required |
| `--secondary` / `--muted` | approximately `#EFF4FA` | Alternating sections, inactive cells, soft panels |
| `--muted-foreground` | approximately `#5C6B7A` | Supporting copy and annotations |
| `--accent` / `--stable` | `#2E77D0` | Active progress and stable status |
| `--border` | approximately `#DFE6EC` | Rules, cards, controls, table rows |
| `--watch` | `#E8A33D` | Watch state and hero emergency rule |
| `--alert` | `#C8453A` | Alert state and caregiver-message rule |
| `--atypical` | `#7A6BC4` | `PATTERN_ATYPICAL`; deliberately outside the severity scale |
| Instrument plate | `#0A121C` | Traces, comparison charts, and limits chapter |
| Instrument stable | `#7FB2F0` | High-contrast stable line on the dark plate |
| Instrument alert | `#E5675C` | High-contrast alert marker on the dark plate |

### Color rules

- Stable is blue, never green. Green would imply “all clear,” which the product cannot
  claim.
- `PATTERN_ATYPICAL` is violet, not a warmer variation of watch/alert; it is a different
  referral pattern, not greater urgency.
- Use status colors only when their exact state is present.
- Body copy on white uses foreground or muted foreground. Avoid mid-grey text below the
  existing contrast level.

## 5. Typography

### Family

- Primary: self-hosted variable `Inter var`, weight 100–900.
- Fallback: system sans, `Noto Sans`, `Noto Sans Devanagari`, and `Noto Sans Gurmukhi`.
- Mono labels: `ui-monospace`, `SFMono-Regular`, Menlo, monospace.
- Latin Inter is self-hosted and precached. Hindi and Punjabi use OS-native Noto coverage.

### Scale

| Element | Specification |
|---|---|
| Hero H1 | `clamp(2.05rem, 5.6vw, 3.9rem)`, 600, line-height 1.03, tracking −0.032em |
| Desktop observed H1 | 62.4 px / 64.27 px |
| Phone observed H1 | 32.8 px / 33.78 px |
| Section H2 | `clamp(1.75rem, 3.4vw, 2.6rem)`, 600, line-height 1.1, tracking −0.025em |
| Section lead | 16 px, 17 px from `sm`, relaxed line-height |
| Hero body | 17 px, 19 px from `sm`, line-height 1.6 |
| Card heading | 15–16 px, 500 |
| Supporting copy | 13–15 px, relaxed line-height |
| Eyebrow/rule label | 10–11 px mono, uppercase, tracking 0.14–0.22em |
| Navigation | 13–15 px |

Headlines use intentional line breaks through `LineReveal`; they are not automatically split
by measuring text. Any copy edit must be checked at 390 px and 1280/1440 px to ensure a
single authored “line” does not wrap again.

## 6. Layout system

- Maximum content width: `max-w-6xl` (72 rem / 1152 px).
- Horizontal page padding: 24 px.
- Section padding: 64 px vertically; 80 px at `lg`.
- Primary desktop layouts use balanced two-column grids, normally 1:1 or 1.15:0.85.
- Cards use 1 px rules and 12–16 px corner radii. The base token is 8 px.
- The limits section uses a 28 px rounded top edge and overlaps the preceding white page by
  24 px.
- White and 50%-opacity pale-blue sections alternate to establish chapter rhythm.
- Long page height is intentional; the 21-day section alone is a 260-vh scroll scene.

### Responsive behavior

| Breakpoint | Behavior |
|---|---|
| Below 640 px | Single-column sections; H1 reduces to ~32.8 px; CTAs stack/wrap; trace lane names are replaced by a compact legend; card padding tightens |
| 640 px and above | Larger body/display type and roomier cards; footer can become a row |
| 768 px and above | Comparison cards and selected card grids become two columns |
| 1024 px and above | Full section navigation appears; hero and major explanation blocks become two columns; care views become four columns |

At 390 px, the header shows only NeuroTrace, Log in, and Open the demo. Section navigation is
hidden. The hero is a 342 px single column with a 40 px grid gap.

## 7. Page architecture

| Order | Anchor | Chapter | Visual purpose |
|---:|---|---|---|
| 0 | `#top` | Hero | State the problem and show one patient's seven-domain trace |
| 1 | `#problem` | The gap | Turn one measured day in ninety into ninety daily observations |
| 2 | `#baseline` | Whose normal | Compare population thresholding with a personal band using identical data |
| 3 | `#laterality` | The second problem | Contrast symmetric Parkinsonian change with one-sided stroke-like change |
| 4 | `#gates` | The decision | Let visitors test four failure scenarios against the three gates |
| 5 | `#run` | Twenty-one days | Scrub through baseline, watch, alert, and no-repeat-notification states |
| 6 | `#device` | On the phone | Explain capture → extraction → comparison → gates → language output |
| 7 | `#measures` | What it measures | List seven gating domains and two non-gating groups |
| 8 | `#care` | One morning, four views | Show role-specific outputs and position Awaaz as a capability |
| 9 | `#limits` | What we do not claim | Make boundaries a first-class dark chapter |
| 10 | none | Closing CTA | Resolve the ninety-day visual and repeat the action |

## 8. Component specifications

### Sticky navigation

- Transparent over the hero at the top.
- After 24 px of scroll: 86%-opaque white ground, 12 px backdrop blur, and bottom rule.
- A 1 px accent progress bar scales across the bottom based on page progress.
- Anchor targets use `scroll-margin-top: 5.5rem`.
- Desktop shows seven section anchors; phone hides them.
- Primary actions are Log in and Open the demo.

### Hero instrument

- Dark 16 px-radius panel with seven stacked canvas lanes.
- Header labels: `SEVEN DOMAINS · ONE PERSON` and current day.
- Entrance animates from day 1 to day 18 in 2.4 seconds.
- Pointer movement inspects one day across all seven lanes.
- Supporting label must state that this is a seeded demo run.
- A subtle parallax offset is desktop/fine-pointer only.

### Ninety-day grid

- 90 square cells with 5 px gaps; one dark appointment day in the sparse state.
- Accent-blue measured layer reveals across the same cells with a soft mask.
- The sparse state must be legible before the fill begins.
- The closing instance is static and shows all ninety days measured.

### Population-band comparison

- Two dark plates show the same survivor trace.
- Left: ninety population traces and the population normal band; the survivor is outside it
  every day.
- Right: the survivor's own learned band; days 19–21 break it.
- Data never rescales between panels. Only the reference changes.
- Demo values are seeded and illustrative, never presented as patient/model output.

### Symmetry diagram

- Two cards shown simultaneously for immediate comparison.
- Mirrored left/right bars make asymmetry perceptually obvious.
- Voice appears as “no side” in both panels.
- Violet verdict: symmetric → `PATTERN_ATYPICAL`, not an alert.
- Red verdict: one-sided → Gate 3 satisfied.

### Gate board

- Four accessible tabs: A bad night, A hoarse throat, Parkinson's, The real thing.
- Board: five sessions × three domains; filled cell means outside personal band; inner tick
  means the finding carries laterality.
- Adjacent verdict panel shows Gate 1–3, pass/fail, and where evaluation stops.
- Selected tab is a dark pill; unselected tabs use bordered pills.
- Scenario switches crossfade narration and animate only the minimal cells/marker.

### Twenty-one-day timeline

- Section owns 260 vh and pins a 100-svh interior on motion-enabled devices.
- Scroll is deliberately non-linear: collection compresses, days 19–21 receive more travel.
- Canvas updates imperatively; React text updates only when the whole day changes.
- Day 20 reveals one caregiver message; day 21 keeps the alert but displays `NO SECOND
  NOTIFICATION`.
- Reduced motion removes pinning and displays a complete static day-20 state.

### On-device pipeline

- Five bordered rows connected by a vertical rail.
- One blue dot travels down the rail while completed rows become fully opaque.
- Steps are numbered `01`–`05`.
- Face panel starts as a clearly labelled diagram. Real camera activation is an explicit
  button and requires browser permission.
- Do not use an unconsented stock portrait under a medical face overlay.

### Domain table

- Seven solid rows for alert-gating domains.
- Domain, measure description, module IDs, and `HAS A SIDE` / `NO SIDE` badge.
- Two dashed cards list non-gating mood/function and vitals/prevention data.
- Mobile stacks each row; desktop uses three aligned columns.

### Care network and Awaaz

- Four equal role cards: Survivor, Caregiver, Clinician, ASHA worker.
- Awaaz sits in one bordered split card below, not as a competing product section.
- Aphasia guidance receives the stronger accent border because confirmation is a safety
  contract, not a secondary detail.

### Limits chapter

- Full-width near-black surface with rounded top corners.
- White/10 rules; white/55–60 supporting text.
- Six limitation cards in a 2-column desktop grid.
- This is a tonal chapter break, not an alarm state.

## 9. Motion system

The landing page has two reveal primitives and one shared scroll ticker.

| Token | Duration | Use |
|---|---:|---|
| Instant | 120 ms | Tiny state acknowledgement |
| Fast | 320 ms | Controls, pills, progress states |
| Medium | 620 ms | Block reveals and crossfades |
| Slow | 1100 ms | Display-line reveals and bar growth |
| Cinematic | 1800 ms | Large numeric/hero transitions |

- Standard easing: `cubic-bezier(0.4, 0, 0.2, 1)`.
- Reveal easing: `cubic-bezier(0.16, 1, 0.3, 1)`.
- Balanced in/out: `cubic-bezier(0.76, 0, 0.24, 1)`.
- Physical/spring acknowledgement: `cubic-bezier(0.34, 1.4, 0.64, 1)`.
- Stagger step: 70 ms.
- Smooth scrolling uses Lenis only on the signed-out landing page, only for fine pointers,
  and never under reduced motion.
- No scroll effect may add its own continuous React state loop. Pixel-only changes write to
  canvas/DOM through the shared animation-frame ticker.

## 10. Accessibility requirements

- Keep the skip link to `#main`.
- Use semantic `header`, `nav`, `main`, `section`, headings, lists, figures, and footer.
- Preserve a logical H1 → H2 → H3 hierarchy.
- All canvas explanations require equivalent `role="img"`, `aria-label`, or screen-reader
  list content.
- Gate scenarios use a real tablist/tabpanel relationship.
- Focus states use a 2 px visible ring with a 2 px offset.
- Interactive controls remain keyboard accessible; anchor navigation works without
  JavaScript.
- Under `prefers-reduced-motion`, scrolling becomes native, pinning/parallax stop, durations
  collapse, and every visual renders a meaningful finished state.
- Touch/coarse pointers use native scrolling and no parallax.
- Never require hover to understand a claim; the hero pointer inspection is additive.
- Check Hindi and Punjabi fallback rendering independently from Latin Inter.

## 11. Content and claim integrity

Design cannot separate evidence labels from the visual they qualify.

- Keep “seeded demo run” adjacent to every synthetic trace.
- Keep published incidence ranges labelled as external ranges, not product measurements.
- Keep acute-stroke/emergency language in the hero.
- Do not use success-green or “all clear” styling.
- Keep limitations on the public page.
- Do not depict a real person beneath a clinical overlay without explicit consent and
  provenance.
- Awaaz must never visually imply that aphasic speech can auto-speak.
- Any duration, scope, privacy, model-performance, dataset, regulatory, or device-validation
  claim must be reconciled with repository evidence before deployment.

## 12. Implementation map

| Concern | Source |
|---|---|
| Page composition and copy | `frontend/src/routes/Landing.tsx` |
| Global tokens and reduced-motion backstop | `frontend/src/index.css` |
| Navigation and progress | `frontend/src/components/landing/LandingNav.tsx` |
| Reveal primitives | `frontend/src/components/motion/Reveal.tsx` |
| Shared motion architecture | `frontend/src/lib/motion.ts` |
| Seeded demo data | `frontend/src/components/landing/traceData.ts` |
| Trace canvas | `frontend/src/components/landing/TraceLanes.tsx` |
| 90-day visual | `frontend/src/components/landing/NinetyDays.tsx` |
| Personal-vs-population chart | `frontend/src/components/landing/PopulationBand.tsx` |
| Laterality comparison | `frontend/src/components/landing/SymmetryDiagram.tsx` |
| Gate interaction | `frontend/src/components/landing/GateBoard.tsx` |
| Scroll timeline | `frontend/src/components/landing/RunTimeline.tsx` |
| On-device sequence | `frontend/src/components/landing/PipelineFlow.tsx` |
| Face diagram/live demo | `frontend/src/components/FaceMeshShowcase.tsx` |

## 13. Design QA checklist

- Test at 390 × 844, 768 × 1024, 1280 × 720, and 1440 × 900.
- Confirm no horizontal overflow at 320–390 px.
- Confirm authored headline lines do not wrap twice.
- Scroll the entire page once before visual regression capture so one-time reveals settle.
- Verify hero pointer inspection, all four gate tabs, the 21-day timeline, and pipeline rail.
- Verify reduced motion, keyboard-only navigation, focus order, and canvas alternatives.
- Confirm header blur/progress begins after scroll and anchors land below the sticky bar.
- Confirm the camera is never requested until `Use my camera` is activated.
- Confirm all synthetic, emergency, privacy, scope, and limitation labels remain visible.
- Run frontend tests, typecheck, production build, and the trace-data tests before merging.
