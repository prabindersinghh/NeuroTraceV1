/**
 * The session's behavioural rules, pinned.
 *
 * These protect the three promises the patient session makes, while the larger
 * TaskShell-vs-ProtocolRunner question is decided separately:
 *
 *   1. Two retries, then move on. Never a third.
 *   2. The confirm state is neutral — no score, no praise, no criticism.
 *   3. Pause is always visible, never in a menu, and never invalidates the session.
 *
 * WHY SOME OF THESE SCAN SOURCE. This project has no DOM test harness (vitest runs
 * `environment: "node"` and includes only `.test.ts`), so a rendered assertion would mean
 * adding jsdom and @testing-library inside a UX branch. Source scanning is already this
 * codebase's idiom for exactly this class of guard — `backend/tests/test_privacy.py`,
 * `test_invariants.py` and `test_regulatory_claims.py` all work this way. The limitation is
 * real and recorded in docs/archive/UX-CHANGES.md: a render-level harness is the right follow-up, and
 * these scans are chosen so they fail on the specific regressions that actually occurred,
 * not merely on the presence of a keyword.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_RETRIES,
  assessCapture,
  canGoBack,
  canGoForward,
  exitSummary,
  mayCapture,
  retriesRemaining,
  stepBack,
  stepForward,
  viewFor,
  violatesConfirmNeutrality,
} from "./taskFlow";
import { STRINGS } from "./i18n";
// Vite's `?raw` rather than node:fs — the app tsconfig types are ["vite/client"] with no
// node types, and reading the file this way needs no new dependency and no config change.
import runnerSource from "../routes/exam/ProtocolRunner.tsx?raw";

// ------------------------------------------------------------------ 1. two retries
describe("two retries, then move on", () => {
  const bad = { ok: false, reason: "face_not_detected" };

  it("re-prompts on the first and second failure", () => {
    expect(assessCapture(bad, 0)).toEqual({ action: "retry", retriesUsedAfter: 1 });
    expect(assessCapture(bad, 1)).toEqual({ action: "retry", retriesUsedAfter: 2 });
  });

  it("NEVER asks a third time — it accepts the capture flagged instead", () => {
    expect(assessCapture(bad, 2)).toEqual({ action: "accept_low_quality" });
    // And stays that way however many times it is asked again.
    for (const used of [3, 4, 10]) {
      expect(assessCapture(bad, used).action).toBe("accept_low_quality");
    }
  });

  it("accepts a good capture without consuming a retry", () => {
    expect(assessCapture({ ok: true }, 0)).toEqual({ action: "accept" });
    expect(assessCapture({ ok: true }, 1)).toEqual({ action: "accept" });
  });

  it("accepts a failure with no stated reason rather than re-prompting blankly", () => {
    // Re-prompting without being able to say what went wrong is worse than accepting.
    expect(assessCapture({ ok: false }, 0)).toEqual({ action: "accept" });
  });

  it("counts down remaining prompts and never goes negative", () => {
    expect(retriesRemaining(0)).toBe(2);
    expect(retriesRemaining(1)).toBe(1);
    expect(retriesRemaining(2)).toBe(0);
    expect(retriesRemaining(5)).toBe(0);
  });

  it("holds the limit at two", () => {
    expect(MAX_RETRIES).toBe(2);
  });

  it("keeps retries per-step, not pooled across the session", () => {
    // A patient who struggled with balance has not used up their chances at speech.
    // Modelled by the caller keying on step position; asserted here so the rule is
    // written down rather than implied.
    const balanceUsed = 2;
    const speechUsed = 0;
    expect(assessCapture(bad, balanceUsed).action).toBe("accept_low_quality");
    expect(assessCapture(bad, speechUsed).action).toBe("retry");
  });
});

// ------------------------------------------------ 2. the confirm state is neutral
describe("neutral confirm — no score, praise or criticism at the moment of performance", () => {
  /**
   * The keys the finish screen actually renders. Read from the real i18n table, so this
   * fails if the copy changes rather than passing against a copy of it.
   */
  const CONFIRM_KEYS = ["allDone", "practiceDone", "finish", "onDevice"] as const;

  it("the finish-screen copy carries no praise, criticism or score, in any language", () => {
    for (const key of CONFIRM_KEYS) {
      const entry = (STRINGS as Record<string, Record<string, string>>)[key];
      expect(entry, `i18n key "${key}" is missing`).toBeTruthy();
      for (const [lang, text] of Object.entries(entry)) {
        const hits = violatesConfirmNeutrality(text);
        expect(hits, `${key}.${lang} = "${text}" -> ${hits.join(", ")}`).toEqual([]);
      }
    }
  });

  it("the finish-screen copy contains no numeric score", () => {
    // A tick alone proves nothing: a screen can show a neutral tick AND a number. This is
    // the assertion that actually enforces "never a score at the moment of performance".
    for (const key of CONFIRM_KEYS) {
      const entry = (STRINGS as Record<string, Record<string, string>>)[key];
      for (const [lang, text] of Object.entries(entry)) {
        expect(/\d/.test(text), `${key}.${lang} = "${text}" contains a digit`).toBe(false);
      }
    }
  });

  it("the runner's finished block renders no band, score or percentage", () => {
    // Scoped to the finished block so an unrelated band render elsewhere cannot mask a
    // regression here.
    const start = runnerSource.indexOf("if (finished)");
    expect(start).toBeGreaterThan(-1);
    const block = runnerSource.slice(start, runnerSource.indexOf("if (busy)", start));
    expect(block.length).toBeGreaterThan(0);

    for (const forbidden of ["band", "score", "BAND_STYLE", "deviation", "%"]) {
      expect(
        block.toLowerCase().includes(forbidden.toLowerCase()),
        `the finished block references "${forbidden}" — scores belong to the caregiver `
        + "dashboard after aggregation, never at the moment of performance",
      ).toBe(false);
    }
  });
});

// ------------------------------------------------------------------ 3. pause
describe("pause is always visible and never invalidates", () => {
  it("the pause control sits in the step header, not behind a menu", () => {
    // The header block that renders on every step.
    const header = runnerSource.slice(
      runnerSource.indexOf("---- per-step render ----"),
      runnerSource.indexOf("{step.task ==="),
    );
    expect(header).toContain("togglePause");
    for (const hidden of ["<details", "Dropdown", "Menu", "Popover", "aria-haspopup"]) {
      expect(
        header.includes(hidden),
        `the pause control is inside "${hidden}" — it must be directly visible`,
      ).toBe(false);
    }
  });

  it("resuming records that the NEXT task was performed rested", () => {
    // Pause does not invalidate the session, but it IS recorded: a task performed after a
    // rest is measured against a baseline built without one, and that bias masks decline.
    expect(runnerSource).toContain("pausedBeforeNext = true");
    expect(runnerSource).toContain("totalPausedMs");
  });

  it("paused time is excluded from the elapsed clock", () => {
    // Otherwise a 90-minute pause would look like a 90-minute task.
    expect(runnerSource).toMatch(/performance\.now\(\)\s*-\s*st\.startedAt\s*-\s*st\.totalPausedMs/);
  });
});

// ------------------------------------- the two retry regressions this pass fixed
describe("every quality-gated step remounts cleanly on a retry", () => {
  /**
   * `gateQuality` signals a retry by bumping `attempt`; a step only starts over if it
   * carries `key={...attempt}`. Two steps did not, and failed in two different ways:
   *
   *   StepAttention (M10) never remounted — the runner showed "let's try again" above a
   *   component still sitting in its finished state, with no retry control on screen.
   *
   *   StepTapping (M7) had no key AND its finish effect depended on a handler whose
   *   identity changed every render, so both retries were consumed in a few synchronous
   *   passes. The patient saw the banner flash and the session advance; they were never
   *   actually offered the retry.
   */
  const GATED_STEPS = [
    "StepAttention", "StepSpeech", "StepFace", "StepOcular",
    "StepBalance", "StepPronator", "StepTapping", "StepPpg",
  ];

  it.each(GATED_STEPS)("%s is keyed on `attempt` so a retry starts it over", (component) => {
    const tag = runnerSource.indexOf(`<${component}`);
    expect(tag, `${component} is not rendered by the runner`).toBeGreaterThan(-1);
    const openingTag = runnerSource.slice(tag, runnerSource.indexOf(">", tag));
    expect(
      openingTag.includes("key="),
      `<${component}> has no key, so bumping \`attempt\` cannot remount it and the retry `
      + "prompt would appear above a dead control",
    ).toBe(true);
    expect(
      openingTag.includes("attempt"),
      `<${component}>'s key does not include \`attempt\`, so it will not change on a retry`,
    ).toBe(true);
  });

  it("the per-code done handler is memoised, so a failed gate cannot re-enter it", () => {
    // The M7 loop: `done(code)` rebuilt on every render gave the step a new `onDone`
    // identity, which re-fired its finish effect, which re-rendered the runner.
    expect(
      /const\s+done\s*=\s*useCallback/.test(runnerSource)
      || /const\s+done\s*=\s*useMemo/.test(runnerSource),
      "`done` is rebuilt on every render; a step whose finish effect depends on its "
      + "identity will consume every retry in a few synchronous passes",
    ).toBe(true);
  });
});

// ------------------------------------------------------------- the scanner itself
// A guard that has never been shown to catch a real violation, or shown NOT to fire on
// legitimate copy, is not yet trustworthy. This repo has shipped one detector that needed a
// second pass after it flagged its own prohibitions (D-030); these pin both directions.
describe("the confirm-neutrality scanner", () => {
  it("catches praise, criticism and a presented score", () => {
    expect(violatesConfirmNeutrality("Well done!")).not.toEqual([]);
    expect(violatesConfirmNeutrality("That was poor.")).not.toEqual([]);
    expect(violatesConfirmNeutrality("You scored 80%")).not.toEqual([]);
    expect(violatesConfirmNeutrality("शाबाश")).not.toEqual([]);
  });

  it("does NOT fire on copy that DENIES a score", () => {
    // The real false positive: this sentence is the app telling the patient no score
    // exists, which is the behaviour the rule wants — not a violation of it.
    expect(violatesConfirmNeutrality(
      "That was practice — nothing was scored. The real check-ins start tomorrow.",
    )).toEqual([]);
    expect(violatesConfirmNeutrality("यह अभ्यास था — कुछ भी नहीं गिना गया।")).toEqual([]);
  });

  it("does NOT fire on the neutral confirm copy itself", () => {
    expect(violatesConfirmNeutrality("All done ✓")).toEqual([]);
    expect(violatesConfirmNeutrality("हो गया ✓")).toEqual([]);
  });
});


// ------------------------------------------------ 6. going back is view-only (Part 1)
describe("going back shows, it does not reopen", () => {
  it("renders the live step when the view has not moved back", () => {
    expect(viewFor(5, 5)).toEqual({ mode: "live", index: 5 });
  });

  it("never renders past the live step, even if asked to", () => {
    // Guards against a stale viewIndex surviving an advance and rendering a step whose
    // turn has not come — which would let a patient perform tasks out of protocol order
    // and put the module at the wrong point on the fatigue curve (INV-14).
    expect(viewFor(9, 5)).toEqual({ mode: "live", index: 5 });
  });

  it("renders an earlier step in review mode", () => {
    expect(viewFor(2, 5)).toEqual({ mode: "review", index: 2, liveIndex: 5 });
  });

  it("THE RULE: a capture can only be mounted for the live step", () => {
    // If this ever passes for review mode, a completed step can be re-recorded, and the
    // baseline starts learning the patient's best attempt instead of their typical one.
    expect(mayCapture(viewFor(5, 5))).toBe(true);
    for (const earlier of [0, 1, 4]) {
      expect(mayCapture(viewFor(earlier, 5))).toBe(false);
    }
  });

  it("cannot step forward past the live step", () => {
    expect(canGoForward(4, 5)).toBe(true);
    expect(canGoForward(5, 5)).toBe(false);
    expect(stepForward(5, 5)).toBe(5);
    expect(stepForward(2, 5)).toBe(3);
  });

  it("cannot step back past the first step", () => {
    expect(canGoBack(0)).toBe(false);
    expect(stepBack(0)).toBe(0);
    expect(canGoBack(3)).toBe(true);
    expect(stepBack(3)).toBe(2);
  });

  it("walking back and forward again always lands on the live step, still live", () => {
    // The property that matters for the patient: reviewing cannot strand them off the
    // live step, and returning does not leave the step in a non-capturable state.
    let view = 5;
    for (let i = 0; i < 3; i += 1) view = stepBack(view);
    for (let i = 0; i < 9; i += 1) view = stepForward(view, 5);
    expect(view).toBe(5);
    expect(mayCapture(viewFor(view, 5))).toBe(true);
  });
});

describe("the exit summary counts honestly", () => {
  it("counts completed steps, not the one in progress", () => {
    // "You've completed 4 of 21" while looking at step 5 - the live step is being done,
    // not done.
    expect(exitSummary(4, 21)).toEqual({ completed: 4, total: 21 });
  });

  it("is zero before anything has been completed", () => {
    expect(exitSummary(0, 21)).toEqual({ completed: 0, total: 21 });
  });

  it("never claims more completed steps than exist", () => {
    expect(exitSummary(99, 21)).toEqual({ completed: 21, total: 21 });
    expect(exitSummary(-3, 21)).toEqual({ completed: 0, total: 21 });
  });
});
