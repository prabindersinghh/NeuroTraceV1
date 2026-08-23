/**
 * The daily exam route — a thin shell over the protocol runner.
 *
 * The v1 five-step battery lived here (face, speech, tapping, attention, questions,
 * hardcoded ORDER). It has been replaced by `ProtocolRunner`, which executes the 21-step
 * protocol served by `/sessions/plan/{intensity}` with the fall-risk gate, fatigue
 * instrumentation, pause/resume, and per-position submission. Keeping this file as the
 * route boundary preserves every existing link to `/exam/:patientId`.
 */
import ProtocolRunner from "./exam/ProtocolRunner";

export function Exam() {
  return <ProtocolRunner />;
}

/** Guided practice from onboarding — stored, never scored (sessions.is_practice). */
export function ExamPractice() {
  return <ProtocolRunner practice />;
}

export default Exam;
