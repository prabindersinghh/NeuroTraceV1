/**
 * The landing page — what a signed-out visitor sees at `/`.
 *
 * DESIGN PROVENANCE. This adopts the identity of the reference landing the owner pointed
 * at (near-black green-tinted ground, mint/sky accents, Inter with monospace details) —
 * "make the frontend like this exactly, or even better". It is scoped to `.nt-landing`
 * on purpose: the IN-PRODUCT surfaces stay on the light, high-contrast clinical palette,
 * because their users are older post-stroke patients, often in bright Indian daylight,
 * where a dark low-contrast theme is an accessibility regression dressed as taste
 * (D-034). Identity where identity matters; legibility where measurement happens.
 */
import { Link } from "react-router-dom";

const T = {
  bg: "#070908", surface: "#101411", surface2: "#151a16", line: "#262c28",
  text: "#f4f7f2", muted: "#9da8a0", green: "#82e6b2", blue: "#70b7ff", orange: "#ffb45e",
};

const PILLARS = [
  {
    accent: T.green,
    kicker: "AWAAZ · COMMUNICATION",
    title: "Confirmation-first voice",
    body:
      "Dysarthria gets automatic speech above a confidence threshold — the muscles are " +
      "broken, the message is intact. Aphasia only ever gets offered choices, because a " +
      "guess spoken aloud puts words in a mouth that cannot veto them. The gate is " +
      "server-enforced and pinned by tests.",
  },
  {
    accent: T.blue,
    kicker: "DAILY CHECK-IN · 12 MINUTES",
    title: "A baseline of one",
    body:
      "Twenty-one tasks in a fixed order, scored against this person's own median and " +
      "spread — never against a population. Three gates before any alert: persistence, " +
      "cross-modality, and laterality. A frozen reference catches the slow decline an " +
      "adaptive baseline learns to excuse.",
  },
  {
    accent: T.orange,
    kicker: "PRIVACY · ON-DEVICE",
    title: "The recording never leaves the phone",
    body:
      "Face and voice are turned into numbers on the handset and deleted. There is no " +
      "media upload endpoint in the API at all — an invariant with a test that fails if " +
      "one ever appears. Works offline, in airplane mode, in a Tier-3 town.",
  },
];

export default function Landing() {
  return (
    <div
      className="nt-landing min-h-screen"
      style={{
        background: T.bg,
        color: T.text,
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6">
        <header className="flex items-center justify-between py-6">
          <span className="text-lg font-semibold tracking-tight">
            Neuro<span style={{ color: T.green }}>Trace</span>
          </span>
          <nav className="flex items-center gap-3">
            <Link
              to="/login"
              className="rounded-lg px-4 py-2 text-sm"
              style={{ color: T.muted }}
            >
              Sign in
            </Link>
            <Link
              to="/register"
              className="rounded-lg px-4 py-2 text-sm font-medium"
              style={{ background: T.green, color: T.bg }}
            >
              Get started
            </Link>
          </nav>
        </header>

        <main className="flex flex-1 flex-col justify-center py-16">
          <p
            className="mb-4 text-xs tracking-[0.25em]"
            style={{ color: T.green, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
          >
            POST-STROKE MONITORING · EN / हिंदी / ਪੰਜਾਬੀ
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight sm:text-6xl">
            Recovery, seen.
            <br />
            <span style={{ color: T.muted }}>Voice, restored.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed" style={{ color: T.muted }}>
            A daily neurological check-in that learns one person's normal and watches for
            the change that matters — and a communication board that speaks for them
            without ever putting words in their mouth.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              to="/register"
              className="rounded-xl px-6 py-4 text-lg font-medium"
              style={{ background: T.green, color: T.bg }}
            >
              Start a family account
            </Link>
            <Link
              to="/diagnostics"
              className="rounded-xl border px-6 py-4 text-lg"
              style={{ borderColor: T.line, color: T.text }}
            >
              Test this phone first
            </Link>
          </div>
          <p
            className="mt-8 max-w-xl border-l-2 pl-4 text-sm leading-relaxed"
            style={{ borderColor: T.orange, color: T.muted }}
          >
            This is not a medical device and it cannot detect a stroke that is happening
            now. Sudden weakness, a drooping face, or slurred speech is an emergency —
            call 108 first, always.
          </p>
        </main>

        <section className="grid gap-4 pb-16 md:grid-cols-3">
          {PILLARS.map((p) => (
            <article
              key={p.title}
              className="rounded-2xl border p-6"
              style={{ background: T.surface, borderColor: T.line }}
            >
              <p
                className="text-[11px] tracking-[0.2em]"
                style={{ color: p.accent, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
              >
                {p.kicker}
              </p>
              <h2 className="mt-3 text-xl font-semibold">{p.title}</h2>
              <p className="mt-3 text-sm leading-relaxed" style={{ color: T.muted }}>
                {p.body}
              </p>
            </article>
          ))}
        </section>

        <footer
          className="flex flex-wrap items-center justify-between gap-3 border-t py-6 text-xs"
          style={{ borderColor: T.line, color: T.muted }}
        >
          <span>Built for families in Punjab. Works offline. Nothing identifiable leaves the phone.</span>
          <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            v2 · engine deterministic · seed 42
          </span>
        </footer>
      </div>
    </div>
  );
}
