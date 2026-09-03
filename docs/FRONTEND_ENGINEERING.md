# Frontend Engineering Handbook

*How a worker-first, mobile-first operations UI is built to a consistent standard — the stack, the patterns, and the guard-rails. Self-contained and portable: drop it into a new project and follow it. Extracted from a real production factory-ERP frontend; every pattern below is one that actually shipped, and known gaps are called out as gaps rather than smoothed over.*

Its companion, **DESIGN_LANGUAGE.md**, covers what the product looks and feels like (tokens, components, copy). This file covers how it is engineered to that standard.

---

## 1. Stack & structure

**Stack (exact versions from the reference build):**

| Concern | Choice |
|---|---|
| Build tool | **Vite 6** (`@vitejs/plugin-react`) |
| Framework | **React 19** + **TypeScript ~5.7** |
| Styling | **Tailwind CSS 3.4** + CSS custom-property token layer |
| Components | **shadcn/ui** pattern (Radix primitives + `class-variance-authority`), hand-vendored into `src/components/ui` |
| Routing | **react-router-dom 7** |
| Charts | **recharts 2** (lazy-loaded) |
| Icons | **lucide-react** |
| Class mgmt | `clsx` + `tailwind-merge` (via a `cn()` helper), `class-variance-authority` for variants |
| Fonts | `@fontsource-variable/inter` — **self-hosted**, never a CDN link |
| Dates | `date-fns` |
| Scanning | `html5-qrcode` (camera QR) |
| Tests | **vitest** |

**Why this stack:** it is boring on purpose. Vendored shadcn components mean you own the markup and can bend it to worker-first sizing; Tailwind + a token layer means the whole product re-themes from one file; Radix gives accessible primitives without a heavy component framework.

**Folder layout (as practiced):**

```
src/
  App.tsx            # routes + role guards (the single routing source of truth)
  main.tsx           # mount
  index.css          # imports token + motion CSS, then @tailwind layers, then base styles
  styles/
    tokens.css       # ALL colour/elevation/radii/motion custom properties
    motion.css       # keyframes + animation utility classes + reduced-motion
  components/
    ui/              # shadcn primitives (button, card, badge, dialog, table, tabs…)
    common/          # app-level shared (Modal, EmptyState, ErrorBoundary, SearchBar…)
    layout/          # AppLayout, Sidebar, Navbar
    dashboard/ charts/ scan/ labels/ catalogue/ audit/ brand/
  lib/
    api.ts           # typed REST client (auth, timeout, retry, mutation bus)
    refresh.ts       # central data-freshness bus + useAutoRefresh
    auth.tsx         # AuthProvider / useAuth
    nav.ts           # route→roles map, per-role home, back-resolution
    roles.ts         # role→display-label
    units.ts         # unit-aware formatting (never blends kg/L)
    offlineQueue.ts  # IndexedDB queue for offline-tolerant actions
    utils.ts         # cn() and friends
  pages/             # one file per screen
  hooks/  types/
```

**Component conventions actually followed:**
- **`cn()` everywhere** for class merging: `cn(base, condition && 'extra', className)` — last-writer-wins via `tailwind-merge`, so a caller's `className` can always override.
- **`cva()` for anything with variants** (button, badge, severity). Variants are named by *role*, not by colour (`variant: 'healthy' | 'destructive'`), so callers never hard-code a hue.
- **Path alias `@` → `src`** (Vite + tsconfig), so imports are `@/lib/api` not `../../lib/api`.
- **One screen = one file** in `pages/`. Screens fetch through `api`, render through `ui`/`common`, and never reach into each other.
- **Heavy screens are `lazy()`-loaded** (every chart dashboard) so the charting library is a separate chunk fetched only when a dashboard opens.

---

## 2. Role-based UI — one nav map, pinned to the guards

The product shows a **different app to each role** (each worker sees only their job). Three things must never drift apart: the **route guards**, the **nav menu**, and the **back-navigation map**. The discipline that keeps them together:

**a) The route guards are the source of truth** — `App.tsx`:

```tsx
function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { user } = useAuth()
  if (user && !roles.includes(user.role)) return <Navigate to="/" replace />
  return <>{children}</>
}
// …
<Route path="dispatch" element={<RequireRole roles={['DISPATCH']}>…</RequireRole>} />
<Route path="stock"    element={<RequireRole roles={['ADMIN']}>…</RequireRole>} />
```

These guards are a **courtesy, not security** — the server enforces every permission independently (the client guard only prevents a pointless render + guaranteed 403). Say this out loud in the code so nobody mistakes it for enforcement.

**b) Per-role home screen** — a single `HomeRoute` switch sends each role to its landing screen, mirrored by a pure `homeFor(role)` in `nav.ts`:

```ts
export function homeFor(role: Role | undefined): string {
  switch (role) {
    case 'OVERSIGHT': return '/oversight'
    case 'DISPATCH':  return '/dispatch'
    case 'OPERATOR':  return '/gate'
    // …one landing per role
    default:          return '/'
  }
}
```

**c) The nav/role map is a single object** (`nav.ts`), declaring who may open each route, plus titles for the header and the Back label:

```ts
export const ROUTE_ROLES: Record<string, Role[] | null> = {
  '/': null,                                    // null = every authenticated role
  '/dispatch': ['DISPATCH'],
  '/stock-levels': ['ADMIN', 'OVERSIGHT'],
  // …
}
```

**d) A STRUCTURAL TEST pins the map to the guards.** This is the pattern most worth copying: the test *parses `App.tsx` itself* and fails if the nav map drifts from the real `<RequireRole>` wrappers — so forgetting to update the map fails a test instead of stranding a user at runtime.

```ts
// nav.spec.ts — parse the real routes out of App.tsx, don't restate them
const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
for (const chunk of source.split(/<Route\s/).slice(1)) {
  const raw = /^path="([^"]+)"/.exec(chunk.trim())?.[1]
  // …extract roles={[…]} and compare to ROUTE_ROLES
}
it('every route in App.tsx is in ROUTE_ROLES with the same roles', () => {
  for (const [path, roles] of declared) {
    expect({ path, roles: ROUTE_ROLES[path] ?? null }).toEqual({ path, roles })
  }
})
```

> **⚠️ Known gap (documented honestly):** this test is **currently red** in the reference project. A `/packing` route was added to `App.tsx` and the sidebar but never added to `nav.ts`, and the test caught it exactly as designed — but the failure is unaddressed because **the frontend vitest suite is not part of the deploy gate** (only `tsc -b && vite build` is; see §5). Consequence: the packer's Back button falls through to a default and `ROUTE_TITLES['/packing']` is `undefined`. The lesson for a new project is the inverse: **the structural test only protects you if it actually runs in CI.** Wire it into the gate (§5) or the guard-rail is decorative.

**e) The sidebar builds from the same role data**, and can additionally react to server feature-flags — hiding an entry the role technically has but a flag has switched off, while the server still enforces the block:

```tsx
const items = navItems.filter((i) => {
  if (i.roles && !(user && i.roles.includes(user.role))) return false
  if (i.to === '/purchase-orders' && user?.role === 'ADMIN' && inwardAccess === 'off') return false
  return true
})
```

---

## 3. Data layer — one client, one freshness bus, server-computed numbers

**a) The API client (`api.ts`)** is a thin typed wrapper over `fetch` with four jobs: attach the bearer token, time out, retry *only* safe failures, and notify the freshness bus after a mutation.

- **Auth:** JWT in `localStorage`; a `401` clears it and fires `onUnauthorized` listeners so the auth layer redirects to login. Isolation lives in the token (server-side), so the client never has to reason about scope.
- **Timeout via `AbortController`** (default 20s; 60s for uploads and blobs).
- **Retry only connection-level failures** — where *no HTTP response arrived* (network drop / timeout). Never retry a 4xx/5xx (that would double-submit). Defaults: **GET = 2 retries, login = 3, other mutations = 0**, with linear backoff:

```ts
async function doFetch(path, init, opts = {}) {
  const retries = opts.retries ?? 0
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000)
    try { return await fetch(`${API_BASE_URL}${path}`, { ...init, signal: controller.signal }) }
    catch (err) {                     // only reached when no response arrived
      if (attempt >= retries) break
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)))
    } finally { clearTimeout(timer) }
  }
  throw new ApiError(aborted ? 'The server took too long…' : 'Cannot reach the server…', 0, aborted ? 'TIMEOUT' : 'NETWORK')
}
```

- **Uploads never auto-retry** (`postForm`, 60s timeout) — a retried upload risks a duplicate record; a slow link deserves patience, not duplication.
- **`warmUp()`** pings `/health` fire-and-forget to wake a cold-started container before the user acts.
- **Errors are a typed `ApiError`** carrying `status` + `code`, and the network/timeout messages are already plain-language (`'Cannot reach the server. Please check your connection and try again.'`) — see DESIGN_LANGUAGE.md §5.
- **Base URL is normalised**, so a misconfigured env var can't silently break: a bare hostname gets `https://`, a missing `/api` suffix is appended. Same-origin `/api` is the default (the dev server proxies it).

**b) The central refresh bus (`refresh.ts`)** solves the "screen went stale because another role changed the number" problem — without polling everything. One bus, one hook, four triggers:

- **window focus / tab visible again** → refetch (throttled to 15s, so tab-flipping doesn't storm a mobile connection)
- **network reconnect** → refetch (same throttle)
- **any successful mutation** → every mounted screen refetches *immediately* (the `api` client calls `notifyMutation(path)` after every post/put/patch/del) — so no page hand-wires "refetch after save"
- **optional visibility-gated polling** → only for screens someone passively watches (a progress bar mid-run), never a global interval

The decision is a **pure, unit-tested function** — the piece most likely to silently regress into stale screens:

```ts
export function shouldRefetch(reason, now, lastFetchAt, throttleMs = 15_000): boolean {
  if (reason === 'mutation' || reason === 'interval') return true   // never throttled
  return now - lastFetchAt >= throttleMs                            // focus/online throttled
}
```

A screen opts in by wrapping its existing loader — the hook adds triggers, never changes *what* is fetched (so role isolation is preserved by construction: same fetch, same token):

```ts
useAutoRefresh(load, { intervalMs: 4000, enabled: activeTab === 'progress' })
```

**c) Server-computed numbers only — the client never derives a total that can drift.** The backend returns pre-computed, unit-aware breakdowns; the client *formats*, it does not *sum*. Critically, incompatible units are never blended into one figure:

```ts
// units.ts — one unit → "97.8 kg"; mixed → "1,200 kg · 340 L"; never summed
export function formatUnitTotals(totals, opts) {
  if (!totals || totals.length === 0) return opts?.zero ?? '0 kg'
  return totals.map((t) => `${nf.format(t.total)} ${t.unit}`).join(' · ')
}
```

The rule: **if a number can be wrong two ways (client math vs server math), compute it once, on the server.** The client's job is faithful display.

---

## 4. Resilience rules

**a) Deploy-skew tolerance — new UI must survive an old API, and vice-versa.** Frontend and backend deploy independently (different hosts), so for a few minutes they are mismatched. Rules that make that a non-event:
- **Every additive API field is optional on the client type** (`byFamily?: …`). A new UI reading a field an old API doesn't send yet must render *without* it, not crash.
- **Screens degrade, they don't blank.** A card that can't compute its enrichment shows the base figure; a per-family line simply doesn't render when the data isn't there.
- Never make a newly-added response field a hard dependency of a screen's first paint.

**b) Graceful degradation when a dependency is down.** Feature-flag and health reads **default to the permissive/last-known-good value on any error**, so a transient read failure can never hide a control the user is still allowed to use:

```ts
// useSystemFlag.ts — defaults 'on'; a flag-read hiccup never removes a live tab
api.get('/system-flags/store-inward-access')
   .then((r) => setValue(r.value === 'off' ? 'off' : 'on'))
   .catch(() => setValue('on'))
```

When a whole dependency is down (e.g. document storage), the pattern is a **degradation banner** that tells the worker what still works and what to do instead — the task continues in a reduced mode rather than dead-ending (see DESIGN_LANGUAGE.md §3, banners).

**c) Offline-tolerant actions where the floor demands it.** Receiving actions are persisted to **IndexedDB** and flushed when back online; the backend endpoints are **idempotent**, so re-sending a queued action is safe (`offlineQueue.ts`). Reserve this for the few actions that genuinely happen in dead zones — it's real complexity, not a default for every mutation.

**d) Build-time env vars and the redeploy gotcha.** Vite **inlines `import.meta.env.VITE_*` at build time** — they are baked into the bundle, not read at runtime. Consequences to write on the wall:
- Changing `VITE_API_URL` (or any `VITE_*`) requires a **rebuild + redeploy**; editing the host's env var alone does nothing to an already-built bundle.
- `import.meta.env.DEV` is statically `false` in production, so dev-only routes/chunks (a design-system reference page) are **tree-shaken out** of the shipped bundle.
- Reference env vars: `VITE_API_URL` (API origin; defaults to same-origin `/api`), `VITE_HTTPS=true` (dev server over HTTPS — required for phone-camera `getUserMedia`), `VITE_API_PROXY` (dev proxy target).

---

## 5. Quality gates

**a) Exit-code build verification is the real gate.** The build script is:

```json
"build": "tsc -b && vite build"
```

`tsc -b` runs first with **`noUnusedLocals`/`noUnusedParameters` on**, so an unused import or variable (`TS6133`) **fails the build** — dead code can't ship. Treat a non-zero exit as a hard stop; never "it's just a warning."

**b) Structural tests worth copying.** Beyond behaviour tests, two structural patterns pay for themselves:
- **The nav-map test** (§2d): parse `App.tsx` and assert the nav/role map matches the real guards. Catches the "added a route, forgot the menu/back-map" class of bug at test time.
- **Pure-logic pins** for anything that fails *silently*. The freshness decision is pinned so a regression that reintroduces stale screens fails a test instead of shipping invisibly:
  ```ts
  it('always refetches on a mutation — even immediately after a fetch', () => {
    expect(shouldRefetch('mutation', t0, t0)).toBe(true)
  })
  it('throttles focus: a quick tab-flip does not refetch, a real return does', () => {
    expect(shouldRefetch('focus', t0 + 2000, t0)).toBe(false)
    expect(shouldRefetch('focus', t0 + 15_000, t0)).toBe(true)
  })
  ```
  (Role/permission *isolation* is asserted primarily in the backend suite, which is the real enforcement boundary; the frontend pins the navigation and freshness logic.)

> **⚠️ Known gap:** in the reference project the frontend **vitest suite is not wired into the deploy gate** — only `tsc -b && vite build` runs before deploy. That is why the `/packing` nav drift (§2d) reached production with a red test nobody saw. **Fix in a new project:** make `npm test` (or at least the structural specs) a required step in CI alongside the type-check + build.

**c) The phone visual check.** Because the audience is a worker on a phone, the last gate before shipping a screen is opening it **on an actual phone (or `pointer:coarse` emulation)** and confirming: tap targets are thumb-sized, the primary action is reachable one-handed, text is legible at arm's length, and nothing needs a horizontal scroll. This is a manual gate, and it is not optional for a worker-facing screen.

---

## 6. Setup checklist — applying all of this to a fresh project

1. **Scaffold** Vite + React + TypeScript; add Tailwind 3.4 + PostCSS + autoprefixer.
2. **Paste the token block** — copy `styles/tokens.css` and `styles/motion.css` from DESIGN_LANGUAGE.md and fill the brand token values for the new project. Import them **before** `@tailwind` in `index.css` (an `@import` after the Tailwind directives is silently dropped).
3. **Wire the Tailwind config** to read the CSS variables (`colors: { primary: 'hsl(var(--primary))', … }`, the type scale, radii, shadows, `tailwindcss-animate` plugin).
4. **Self-host the font** via `@fontsource-variable/*` (never a CDN `<link>` — it fails silently under a strict CSP and falls back to system-ui).
5. **Add `cn()`** (`clsx` + `tailwind-merge`) and install the base **shadcn/ui** components you need (button, card, badge, dialog, table, tabs, input, select, toast). Give `button` the **`pointer:coarse` min-height** (44px) touch-target variants.
6. **Build the API client** (`api.ts`): token store, `ApiError`, `doFetch` with timeout + connection-only retry (GET=2, login=3, mutations=0), plain-language network errors, and the `afterMutation → notifyMutation` hook.
7. **Add the refresh bus** (`refresh.ts`): `subscribe`/`notifyMutation`, the pure `shouldRefetch`, and `useAutoRefresh`; have `api` mutations call `notifyMutation`.
8. **Add the auth layer** (`auth.tsx`): `AuthProvider`/`useAuth`, restore-from-token on load, `onUnauthorized` → logout.
9. **Define the nav/role map** (`nav.ts`): `ROUTE_ROLES`, `ROUTE_TITLES`, `homeFor(role)`, and back-resolution.
10. **Add the route guards** (`App.tsx`): `RequireRole`, per-role `HomeRoute`, `<Route>`s mirroring `ROUTE_ROLES`; lazy-load chart/dashboard screens.
11. **Add the nav-map structural test** and **wire the test suite into CI** alongside `tsc -b && vite build` (don't repeat the reference project's gap — a structural test that doesn't run protects nothing).
12. **Adopt the copy rules** (DESIGN_LANGUAGE.md §5): verbs on buttons, numbers over sentences, plain-language errors, never a raw code.
13. **Configure env** (`VITE_API_URL`, optional `VITE_HTTPS` for phone-camera dev) and document the *rebuild-to-change* gotcha next to them.
14. **Set up resilience defaults:** optional fields on all additive API types, permissive feature-flag defaults, a degradation-banner component, and (only if the floor needs it) the IndexedDB offline queue.
15. **Establish the phone visual check** as the final pre-ship step for every worker-facing screen.

---

*This document reflects the reference implementation as built, including its live gaps. When you deviate from it in your own project, deviate on purpose and write down why — the same way the gaps above are written down here.*
