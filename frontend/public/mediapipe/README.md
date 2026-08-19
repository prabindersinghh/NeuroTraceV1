# MediaPipe assets (served from our own origin)

Fetched by `src/lib/ondevice/face.ts` and precached by the service worker so the exam runs
with no network at all. They are **not** committed — they are large binaries, and a git
repository is the wrong place for them.

Fetch them once before building:

```bash
cd frontend
npm run fetch:mediapipe
```

That downloads:

| Path | What |
|---|---|
| `wasm/` | MediaPipe Tasks vision runtime (SIMD and non-SIMD builds) |
| `face_landmarker.task` | the 468-point FaceMesh model, ~4 MB |

**Why local rather than a CDN.** The claim is that a patient in a Tier-2/3 town with
intermittent data completes their check-in anyway. A model fetched from a CDN on first use
fails in exactly the situation the product exists for. It would also mean a third party
receives a request every time someone opens the camera, which undercuts the privacy posture
even though no image data would be in that request.

The runtime version is pinned in the fetch script. Do not float it: a different landmarker
build would shift the landmark output, and every existing patient baseline is expressed in
terms of those landmarks.
