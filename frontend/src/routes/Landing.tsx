/**
 * The public landing page — `/` when signed out.
 *
 * POSITIONING, which is the point of this file.
 * NeuroTrace is a POST-STROKE RECOVERY ECOSYSTEM. What it is: a measurement system that
 * learns one survivor's normal across seven body systems and detects deterioration before
 * anyone in the house can name it. Awaaz is ONE capability inside that ecosystem — a real
 * one, and the one that moves a room — but it is a feature of the product, not the
 * product. Every section below is ordered on that basis: the daily measurement and the
 * engine lead; Awaaz appears as a capability card and gets its own section further down.
 *
 * DESIGN: light, editorial, near-black on warm white with one blue accent — matching the
 * reference the owner supplied. This supersedes the dark treatment (D-034 revised): the
 * product surfaces were already light for legibility, and a landing that matches them is
 * one identity instead of two.
 *
 * IMAGERY: Unsplash, hotlinked with their documented CDN parameters, under the Unsplash
 * licence (free for commercial use, no attribution required). External requests are
 * acceptable HERE and nowhere else in the product: a marketing page has no offline
 * promise and no patient on it. The exam never loads a third-party asset — that is INV-1
 * territory.
 *
 * There is deliberately NO stock portrait in the hero. The mesh runs on the visitor's own
 * camera, opt-in, or shows a labelled diagram — see FaceMeshShowcase for why putting a
 * real person's face under a medical overlay on this page is not ours to do.
 */
import { Link } from "react-router-dom";

import { FaceMeshShowcase } from "@/components/FaceMeshShowcase";

const U = (id: string, w = 1200) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=70`;

// Verified by eye, not by filename — the first portrait picked for the hero turned out to
// be a studio shot of a young bearded man, and the "home" candidate was an office.
const IMG = {
  /** A clinician in a white coat holding a phone. No identifiable face. */
  clinician: U("1576091160399-112ba8d25d1d", 1000),
  /** Two people's hands, one holding the other. No identifiable face. */
  hands: U("1584515933487-779824d29309", 1000),
};

const SYSTEMS = [
  ["Cranial nerves", "Face symmetry, eye movement, tongue and palate"],
  ["Motor speech", "Articulation rate, timing, voice quality"],
  ["Language", "Naming, comprehension, word finding"],
  ["Motor", "Tapping speed, drift, fine control, left versus right"],
  ["Coordination & gait", "Finger-to-nose, alternating movement, walking"],
  ["Posterior / vestibular", "Saccades, pursuit, balance, subjective vertical"],
  ["Cognition & mood", "Reaction time, memory, attention, PHQ-2"],
];

const PIPELINE = [
  ["01", "Capture", "The phone camera and microphone record a task. Nothing is stored."],
  ["02", "Extract on device", "MediaPipe landmarks and DSP turn the signal into numbers, in the browser. The recording is discarded in the same tick."],
  ["03", "Compare to their own baseline", "Median and MAD over a 12-session window, robust z, RCI, CUSUM — never a population average."],
  ["04", "Three gates", "Persistence, then cross-modality, then laterality. All three, or it is not an alert."],
  ["05", "Explain in their language", "A guardrailed template in English, Hindi or Punjabi — with what changed, and what to do."],
];

const MODELS = [
  ["Face landmarker", "468 points, on device", "MediaPipe, SHA-pinned"],
  ["Pose landmarker", "33 points for balance and drift", "MediaPipe, SHA-pinned"],
  ["Dysarthria classifier", "Advisory signal into motor speech", "Synthetic — awaiting TORGO/UASpeech"],
  ["Rhythm irregularity", "“Get an ECG” advisory from fingertip PPG", "Synthetic — awaiting PhysioNet AF"],
  ["Asymmetry discriminator", "Empirical basis for the laterality gate", "Synthetic — awaiting mPower"],
];

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 font-mono text-xs tracking-[0.22em] text-accent">{children}</p>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ---------------------------------------------------------------- header */}
      <header className="sticky top-0 z-40 border-b border-line bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <span className="text-lg font-semibold tracking-tight">NEUROTRACE</span>
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#ecosystem" className="hover:text-foreground">The ecosystem</a>
            <a href="#technology" className="hover:text-foreground">Technology</a>
            <a href="#engine" className="hover:text-foreground">The engine</a>
            <a href="#awaaz" className="hover:text-foreground">Awaaz</a>
            <a href="#care" className="hover:text-foreground">Care network</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/login" className="px-3 py-2 text-sm text-muted-foreground">Log in</Link>
            <Link
              to="/register"
              className="rounded-xl bg-foreground px-5 py-2.5 text-sm font-medium text-background"
            >
              Open demo →
            </Link>
          </div>
        </div>
      </header>

      {/* ---------------------------------------------------------------- hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-2 lg:py-24">
        <div>
          <Kicker>■ POST-STROKE RECOVERY ECOSYSTEM</Kicker>
          <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            Recovery, seen.
            <br />
            <span className="text-muted-foreground">Measured every day.</span>
            <br />
            One phone. No wearable.
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-relaxed text-muted-foreground">
            After discharge a survivor is at home for 167 hours a week and seen by a
            clinician for one. NeuroTrace measures seven body systems daily on an ordinary
            phone, learns what is normal <em>for that person</em>, and raises a flag only
            when the change is persistent, cross-modal and one-sided.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link to="/register" className="rounded-xl bg-foreground px-6 py-4 text-base font-medium text-background">
              Explore the ecosystem →
            </Link>
            <Link to="/diagnostics" className="rounded-xl border border-line px-6 py-4 text-base">
              Test this phone
            </Link>
          </div>
          <p className="mt-8 max-w-xl border-l-2 border-watch pl-4 text-sm leading-relaxed text-muted-foreground">
            Not a medical device, and it cannot detect a stroke that is happening now.
            Sudden weakness, a drooping face or slurred speech is an emergency — call 108
            first, always.
          </p>
        </div>

        {/* The mesh is the hero image: our actual model, running in the visitor's browser. */}
        <div>
          <FaceMeshShowcase />
          <p className="mt-3 font-mono text-xs tracking-wide text-muted-foreground">
            DIAGRAM — turn on your camera to run the real landmarker, in your browser.
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- ecosystem */}
      <section id="ecosystem" className="border-y border-line bg-surface/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <Kicker>01 · WHAT THE ECOSYSTEM COVERS</Kicker>
          <h2 className="max-w-3xl text-4xl font-semibold tracking-tight">
            Seven body systems, twenty-one tasks, twelve minutes.
          </h2>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
            A stroke does not decline in one channel. Neither does the measurement. Every
            task feeds a domain, and an alert requires two independent domains to agree —
            which is what separates a real change from a bad night's sleep.
          </p>
          <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {SYSTEMS.map(([name, detail]) => (
              <div key={name} className="bg-background p-5">
                <p className="font-medium">{name}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{detail}</p>
              </div>
            ))}
            <div className="bg-accent p-5 text-accent-foreground">
              <p className="font-medium">Vitals & prevention</p>
              <p className="mt-1.5 text-sm leading-relaxed opacity-90">
                Fingertip PPG rhythm, blood pressure, medication adherence
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- technology */}
      <section id="technology" className="mx-auto max-w-6xl px-6 py-20">
        <Kicker>02 · HOW THE MEASUREMENT WORKS</Kicker>
        <h2 className="max-w-3xl text-4xl font-semibold tracking-tight">
          The recording never leaves the phone.
        </h2>
        <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
          Feature extraction runs in the browser. The server receives numbers and has no
          endpoint that accepts media at all — an invariant with a test that fails the
          build if one ever appears.
        </p>

        <ol className="mt-10 grid gap-4 md:grid-cols-5">
          {PIPELINE.map(([n, title, body]) => (
            <li key={n} className="rounded-2xl border border-line p-5">
              <span className="font-mono text-xs text-accent">{n}</span>
              <p className="mt-2 font-medium">{title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-12">
          <div>
            <h3 className="text-2xl font-semibold tracking-tight">The models we run</h3>
            <p className="mt-3 text-muted-foreground">
              Two are production landmarkers, pinned by content hash so a silently swapped
              model cannot shift a patient's baseline. Three are classifiers that are
              honestly <strong>synthetic today</strong> — trained on generated fixtures
              while dataset access is pending, and labelled that way in the repository, in
              every model card, and here.
            </p>
            <table className="mt-5 w-full border-collapse text-sm">
              <tbody>
                {MODELS.map(([name, role, status]) => (
                  <tr key={name} className="border-b border-line last:border-0">
                    <td className="py-2.5 pr-3 font-medium">{name}</td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{role}</td>
                    <td className="py-2.5 text-right text-xs text-muted-foreground">{status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- engine */}
      <section id="engine" className="border-y border-line bg-surface/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <Kicker>03 · THE ENGINE</Kicker>
          <h2 className="max-w-3xl text-4xl font-semibold tracking-tight">
            Three gates. All three, or it is not an alert.
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              ["Persistence", "Two consecutive valid sessions. One bad morning is not a finding."],
              ["Cross-modality", "Two independent domains above threshold. Agreement is the evidence."],
              ["Laterality", "At least one persistent domain one-sided, sustained. A stroke has a side."],
            ].map(([t, b]) => (
              <div key={t} className="rounded-2xl border border-line bg-background p-6">
                <p className="text-lg font-medium">{t}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{b}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-2xl border border-line bg-background p-6">
            <p className="font-medium">Symmetric change is reported, not alerted on.</p>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              Slowed movement, quiet voice and reduced facial expression arriving together
              on <em>both</em> sides is characteristic of a progressive movement disorder,
              not a vascular event. Without the laterality gate that pattern would produce
              this system's most confident alert — and the wrong referral. It is surfaced
              as an atypical pattern instead, and the engine says so in plain language.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- awaaz (a feature) */}
      <section id="awaaz" className="mx-auto max-w-6xl px-6 py-20">
        <Kicker>04 · A CAPABILITY INSIDE THE ECOSYSTEM</Kicker>
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <h2 className="text-4xl font-semibold tracking-tight">Awaaz — so they can be understood</h2>
            <p className="mt-5 text-lg text-muted-foreground">
              A communication board for survivors whose speech was affected. It shares the
              ecosystem's measurements: the speech profile that decides how it behaves is
              the same one the daily check-in produces.
            </p>
            <div className="mt-6 space-y-4 text-sm leading-relaxed">
              <p className="rounded-xl border border-line p-4">
                <strong>Dysarthria</strong> — the muscles are affected, the message is
                intact. Recognised speech above the confidence threshold is spoken aloud
                automatically.
              </p>
              <p className="rounded-xl border-2 border-accent/40 bg-accent/5 p-4">
                <strong>Aphasia</strong> — the language system is affected and the intended
                message may not exist in the words produced. The system only ever
                <em> offers candidates</em>. Nothing is spoken until the patient taps one.
                Putting words into a mouth that cannot veto them is the one thing this
                feature must never do, and the rule is enforced on the server.
              </p>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-line">
            <img src={IMG.hands} alt="Two people's hands, one holding the other"
                 className="h-full w-full object-cover" loading="lazy" />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- care network */}
      <section id="care" className="border-t border-line bg-surface/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <Kicker>05 · THE CARE NETWORK</Kicker>
          <h2 className="max-w-3xl text-4xl font-semibold tracking-tight">
            Four people, four different views of the same day.
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[
              ["Survivor", "One button. A short session. Never a score, never a warning — that is not what they need from us each morning."],
              ["Caregiver", "A band, a sentence about what changed, and what to do. Confounders printed, not hidden."],
              ["Clinician", "A ranked roster, gate states, laterality, drift against a frozen reference, and an audit log."],
              ["ASHA worker", "A household list with task-level due items, offline-first, syncing when the network returns."],
            ].map(([who, what]) => (
              <div key={who} className="rounded-2xl border border-line bg-background p-6">
                <p className="font-medium">{who}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{what}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_1.2fr]">
            <div className="overflow-hidden rounded-2xl border border-line">
              <img src={IMG.clinician} alt="A clinician in a white coat holding a phone" className="h-full w-full object-cover" loading="lazy" />
            </div>
            <div className="flex flex-col justify-center">
              <h3 className="text-2xl font-semibold tracking-tight">Built for where the patients are</h3>
              <p className="mt-3 text-muted-foreground">
                English, Hindi and Punjabi throughout. The session completes in airplane
                mode and syncs later. Nothing depends on a wearable, a clinic visit, or a
                stable connection — because in the districts this is for, none of those
                are reliable.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- cta */}
      <section className="mx-auto max-w-6xl px-6 py-20 text-center">
        <h2 className="text-4xl font-semibold tracking-tight">See the twenty-one day story</h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
          The demo replays a real-shaped recovery: eighteen stable days, then two domains
          drifting together, then the alert — with every gate shown.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link to="/register" className="rounded-xl bg-foreground px-7 py-4 text-base font-medium text-background">
            Open the demo →
          </Link>
          <Link to="/login" className="rounded-xl border border-line px-7 py-4 text-base">Log in</Link>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-8 text-xs text-muted-foreground">
          <span>Built for families in Punjab. Works offline. Nothing identifiable leaves the phone.</span>
          <span className="font-mono">post-stroke recovery ecosystem · engine deterministic · seed 42</span>
        </div>
      </footer>
    </div>
  );
}
