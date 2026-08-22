/**
 * Demo clip manifest — task key to video URL.
 *
 * Every task shows a short looping clip of the movement before the patient attempts it.
 * A spoken instruction alone is not enough for this population: it includes people with
 * aphasia, for whom a sentence may not arrive at all, and people who have never used a
 * smartphone. Showing beats telling.
 *
 * HOW TO ADD CLIPS
 * ----------------
 * Drop the files into `frontend/public/demo/` named exactly `<MODULE>-<task>.mp4` — the
 * keys below already spell out every filename. Nothing else needs editing: a missing file
 * resolves to `undefined`, `TaskShell` skips the demo phase, and the task still runs. That
 * is deliberate. Clips arriving one at a time must never leave the app in a broken state,
 * and a task that refuses to start because a marketing asset is missing would be absurd.
 *
 * `docs/DEMO_CLIPS.md` is the shot list: duration, framing and what each clip must show.
 */

/** Vite serves `public/` from the site root, and the service worker precaches it. */
const clip = (name: string) => `/demo/${name}.mp4`;

/** Key is `<module>.<task>`, matching the protocol in `session_plan.py`. */
export const DEMO_CLIPS: Record<string, string> = {
  "M10.simple_and_choice_rt": clip("M10-simple_and_choice_rt"),
  "M11.word_encoding": clip("M11-word_encoding"),
  "M4.sustained_ddk_sentence": clip("M4-sustained_ddk_sentence"),
  "M1.facial_battery": clip("M1-facial_battery"),
  "M2.tongue_palate": clip("M2-tongue_palate"),
  "M3.horizontal_saccades": clip("M3-horizontal_saccades"),
  "M3.vertical_saccades": clip("M3-vertical_saccades"),
  "M3.smooth_pursuit": clip("M3-smooth_pursuit"),
  "M3.gaze_holding": clip("M3-gaze_holding"),
  "M21.svv_static_and_dynamic": clip("M21-svv_static_and_dynamic"),
  "M9.romberg_eyes_open": clip("M9-romberg_eyes_open"),
  "M9.romberg_eyes_closed": clip("M9-romberg_eyes_closed"),
  "M9.tandem_stance": clip("M9-tandem_stance"),
  "M6.pronator_drift": clip("M6-pronator_drift"),
  "M7.finger_tapping": clip("M7-finger_tapping"),
  "M8.finger_to_nose": clip("M8-finger_to_nose"),
  "M8.rapid_alternating": clip("M8-rapid_alternating"),
  "M11.delayed_recall": clip("M11-delayed_recall"),
  "M13.phq2": clip("M13-phq2"),
  "M19.medication_confirm": clip("M19-medication_confirm"),
  "M17.ppg_rhythm": clip("M17-ppg_rhythm"),
};

/**
 * Resolve a clip for a task. Returns undefined when there is no clip, which TaskShell
 * treats as "start at the instruction step" rather than as an error.
 */
export function demoClipFor(module: string, task: string): string | undefined {
  return DEMO_CLIPS[`${module}.${task}`];
}
