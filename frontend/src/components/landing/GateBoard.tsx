/**
 * The three gates, as four things that go wrong.
 *
 * A gate is only interesting because of what it refuses, so this is built as a set of
 * scenarios rather than a set of features: pick a way the system could have been fooled,
 * and watch which gate catches it. Every scenario here is one the engine's own source
 * names as its reason for existing (backend/app/engine/gates.py) — a bad night, a hoarse
 * throat, Parkinson's disease, and the real thing.
 *
 * Five sessions × three domains is small enough to read at a glance and is the smallest
 * grid on which all three gates are visible at once: persistence runs across, corroboration
 * runs down, and laterality is the tick inside a cell.
 */
import { useId, useState } from "react";

import { DURATION, EASE } from "@/lib/motion";

interface Row { label: string; note: string; deviating: boolean[]; sided: boolean }

interface Scenario {
  id: string;
  tab: string;
  title: string;
  body: string;
  rows: Row[];
  band: "WATCH" | "ALERT" | "ATYPICAL";
  gates: [boolean, boolean, boolean];
  verdict: string;
}

const SESSIONS = 5;
const none = [false, false, false, false, false];

const SCENARIOS: Scenario[] = [
  {
    id: "night",
    tab: "A bad night",
    title: "One poor session",
    body:
      "He slept badly, the room was dim, and the capture was noisy. The face module deviates hard — on exactly one morning.",
    rows: [
      { label: "Cranial nerves", note: "face", deviating: [false, false, false, true, false], sided: true },
      { label: "Motor speech", note: "voice", deviating: none, sided: false },
      { label: "Motor", note: "hands", deviating: none, sided: false },
    ],
    band: "WATCH",
    gates: [false, false, false],
    verdict: "Gate 1 stops it. One session is an event; two consecutive sessions are a finding. Recorded, visible to the clinician, silent to the family.",
  },
  {
    id: "hoarse",
    tab: "A hoarse throat",
    title: "Every speech feature at once",
    body:
      "A chest infection moves jitter, shimmer, breathiness, phonation time and pa-ta-ka rate together for three days. Five features agreeing looks like overwhelming evidence.",
    rows: [
      { label: "Cranial nerves", note: "face", deviating: none, sided: false },
      { label: "Motor speech", note: "voice", deviating: [false, false, true, true, true], sided: false },
      { label: "Motor", note: "hands", deviating: none, sided: false },
    ],
    band: "WATCH",
    gates: [true, false, false],
    verdict: "Gate 2 stops it. Those five features are correlated — they are one domain, not five opinions. Corroboration has to come from anatomy that could not fail for the same reason.",
  },
  {
    id: "parkinsons",
    tab: "Parkinson's",
    title: "Three domains, and the wrong disease",
    body:
      "Bradykinesia, hypophonia and masked facies arrive together and persist. Face, voice and hand all deviate for days. Under persistence and corroboration alone this is the highest-confidence alert this system can produce.",
    rows: [
      { label: "Cranial nerves", note: "face", deviating: [false, false, true, true, true], sided: false },
      { label: "Motor speech", note: "voice", deviating: [false, false, true, true, true], sided: false },
      { label: "Motor", note: "hands", deviating: [false, false, true, true, true], sided: false },
    ],
    band: "ATYPICAL",
    gates: [true, true, false],
    verdict: "Gate 3 stops it — and this is the gate that earns its keep. A stroke damages one hemisphere and shows a side: one mouth corner, one hand. This is symmetric on every axis, so it is reported as a different pattern pointing at a different referral, not escalated as a stroke.",
  },
  {
    id: "real",
    tab: "The real thing",
    title: "Persistent, corroborated, one-sided",
    body:
      "The same three domains, the same two days — but the deviation lives in the asymmetry features. The left corner, the left hand.",
    rows: [
      { label: "Cranial nerves", note: "face", deviating: [false, false, false, true, true], sided: true },
      { label: "Motor speech", note: "voice", deviating: [false, false, false, true, true], sided: false },
      { label: "Motor", note: "hands", deviating: [false, false, false, true, true], sided: true },
    ],
    band: "ALERT",
    gates: [true, true, true],
    verdict: "All three. The family is told once, in their language, what changed and what to do — and not told again tomorrow while the band holds.",
  },
];

const GATE_NAMES = ["Persistence", "Cross-modality", "Laterality"] as const;

const BAND_STYLE = {
  WATCH: { dot: "bg-watch", text: "text-watch", label: "WATCH" },
  ALERT: { dot: "bg-alert", text: "text-alert", label: "ALERT" },
  ATYPICAL: { dot: "bg-atypical", text: "text-atypical", label: "PATTERN_ATYPICAL" },
} as const;

export function GateBoard() {
  const [active, setActive] = useState(0);
  const scenario = SCENARIOS[active];
  const id = useId();

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-10">
      {/* -------------------------------------------------------------- the board */}
      <div>
        <div role="tablist" aria-label="Ways the system could be fooled" className="flex flex-wrap gap-1.5">
          {SCENARIOS.map((s, i) => (
            <button
              key={s.id}
              role="tab"
              id={`${id}-tab-${i}`}
              aria-selected={i === active}
              aria-controls={`${id}-panel`}
              type="button"
              onClick={() => setActive(i)}
              className={`focus-ring rounded-full border px-3.5 py-1.5 text-[13px] transition-colors ${
                i === active
                  ? "border-foreground bg-foreground text-background"
                  : "border-line text-muted-foreground hover:border-foreground/40 hover:text-foreground"
              }`}
            >
              {s.tab}
            </button>
          ))}
        </div>

        <div className="mt-5 rounded-2xl border border-line bg-background p-5 sm:p-6">
          <div className="flex items-baseline justify-between gap-4">
            <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground">
              LAST {SESSIONS} SESSIONS
            </p>
            <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground">
              |z| ≥ 2.0
            </p>
          </div>

          <div className="mt-4 space-y-2.5">
            {scenario.rows.map((row) => (
              <div key={row.label} className="grid grid-cols-[minmax(88px,auto)_1fr] items-center gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium leading-tight">{row.label}</p>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {row.note}{row.sided ? " · has a side" : " · no side"}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  {row.deviating.map((hit, i) => (
                    <div
                      // eslint-disable-next-line react/no-array-index-key -- fixed 5-session grid
                      key={i}
                      className="relative h-9 flex-1 rounded-md border"
                      style={{
                        borderColor: hit ? "transparent" : "hsl(var(--border))",
                        background: hit
                          ? (scenario.band === "ALERT" ? "hsl(var(--alert))"
                            : scenario.band === "ATYPICAL" ? "hsl(var(--atypical))"
                            : "hsl(var(--watch))")
                          : "transparent",
                        transition: `background-color ${DURATION.fast}ms ${EASE.standard}, border-color ${DURATION.fast}ms ${EASE.standard}`,
                      }}
                    >
                      {hit && row.sided && (
                        <span
                          aria-hidden
                          className="absolute inset-x-0 bottom-1 mx-auto block h-2 w-[2px] rounded-full bg-background/80"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-4 font-mono text-[10px] leading-relaxed tracking-wide text-muted-foreground">
            FILLED = OUTSIDE THEIR OWN BAND · TICK = THE FINDING CARRIES A LEFT/RIGHT SIDE
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------------- the verdict */}
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${active}`}>
        <h3 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{scenario.title}</h3>
        <p className="mt-3 text-[17px] leading-relaxed text-muted-foreground">{scenario.body}</p>

        <div className="mt-6 space-y-px overflow-hidden rounded-xl border border-line">
          {GATE_NAMES.map((name, i) => {
            const passed = scenario.gates[i];
            // The first gate that fails is the one doing the work — say so, once.
            const decisive = !passed && scenario.gates.slice(0, i).every(Boolean);
            return (
              <div
                key={name}
                className="flex items-center gap-3 bg-background px-4 py-3"
                style={{ boxShadow: "inset 0 -1px 0 hsl(var(--border))" }}
              >
                <span
                  aria-hidden
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold"
                  style={{
                    background: passed ? "hsl(var(--stable))" : decisive ? "hsl(var(--foreground))" : "hsl(var(--muted))",
                    color: passed || decisive ? "#fff" : "hsl(var(--muted-foreground))",
                    transition: `background-color ${DURATION.fast}ms ${EASE.standard}`,
                  }}
                >
                  {passed ? "✓" : "✕"}
                </span>
                <span className="text-sm font-medium">Gate {i + 1} · {name}</span>
                <span className="ml-auto font-mono text-[11px] tracking-wider text-muted-foreground">
                  {passed ? "PASSED" : decisive ? "STOPS HERE" : "NOT REACHED"}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex items-start gap-3">
          <span
            aria-hidden
            className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${BAND_STYLE[scenario.band].dot}`}
          />
          <div>
            <p className={`font-mono text-xs tracking-[0.2em] ${BAND_STYLE[scenario.band].text}`}>
              {BAND_STYLE[scenario.band].label}
            </p>
            <p className="mt-2 text-[15px] leading-relaxed">{scenario.verdict}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
