# NeuroTrace — frontend

React 18 + Vite + TypeScript + Tailwind + Recharts. See the [project README](../README.md)
for the full picture.

```bash
npm install
cp .env.example .env.development     # VITE_API_URL=http://localhost:8000
npm run dev                          # http://localhost:5173
npm run build                        # type-check + production bundle into dist/
```

## Routes

| Path | Who | What |
|---|---|---|
| `/login` `/register` | anyone | Auth, plus the one-click demo button |
| `/` | caregiver / clinician | Patient list |
| `/` | patient | A single large "Begin" button, nothing else |
| `/checkin/:patientId` | patient access | The 45-second capture flow |
| `/dashboard/:patientId` | caregiver / clinician | Status card, 3 trend charts, history, alert log |

## Notes

- **Audio is encoded to WAV in the browser** (`src/lib/recording.ts`) rather than sent as
  MediaRecorder's `webm/opus` — libsndfile reads WAV directly, so the server needs no
  `ffmpeg`. Video does use MediaRecorder (`webm/vp8`), which OpenCV decodes.
- **Mic and camera require HTTPS.** `localhost` is exempt; a LAN IP is not. Test mobile
  capture through the deployed URL.
- **The patient never sees a score or a band.** Only "All done ✓". Risk lives on the
  caregiver dashboard (PRD §5).
- **Every capture step is skippable** — the scorer renormalises around whichever modalities
  actually captured, so a denied camera does not waste the voice and tap data.
- `src/lib/api.ts` refreshes the JWT on a 401 and retries once; concurrent 401s share one
  in-flight refresh.
