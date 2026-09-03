# Software bill of materials — Part 5.7

Direct dependencies of both halves of the product, what each is for, and any advisory note.
The authoritative machine-readable sources are `backend/requirements.txt` (direct, pinned),
`backend/requirements.lock.txt` (full transitive freeze, 79 packages) and
`frontend/package.json`.

Generated 2026-08-28 by reading those manifests. One dependency was **removed** —
`python-multipart`, see finding 1 and D-052. Nothing was added or upgraded.

---

## Findings that need a decision

### 1. `python-multipart` — REMOVED (D-052)
Grepping `backend/app/` for `multipart` returns **zero** matches. This is the library FastAPI
requires in order to accept file uploads — i.e. the single dependency whose only purpose is
the thing INV-1 forbids.

Nothing is currently wrong: no route accepts an upload, and three separate tests enforce
that (source scan, schema scan, and a new OpenAPI scan added this run). But removing it
would make INV-1 **structurally** true rather than only test-true: with the library absent,
a future `UploadFile` parameter fails at import rather than passing review. That is
defence-in-depth on the product's central privacy claim, for the cost of deleting one line.

**Done.** Removed from `requirements.txt` and `requirements.lock.txt`, and actually
uninstalled to verify rather than assume: the app imports, all 76 routes register, and the
OpenAPI document still generates. `test_inv1_the_file_upload_library_is_not_a_dependency`
asserts neither manifest re-pins it. See D-052.

### 2. `bcrypt==4.0.1` is pinned well behind current
Held back deliberately: `passlib==1.7.4` is unmaintained and breaks against bcrypt ≥ 4.1
(the `__about__` attribute removal). This is a known, widely-hit pin, not an oversight. No
known vulnerability in 4.0.1 itself. The real remediation is migrating off `passlib`
entirely to `bcrypt` directly or to `argon2-cffi` — a security-hygiene task worth scheduling,
not an emergency.

Practical note observed this run: bcrypt at 12 rounds is what makes the backend suite take
tens of minutes on this machine (~8–11s per test that creates a user). That is correct
behaviour for production and painful for tests; a lower cost factor under a test-only
setting would cut suite time dramatically. Not changed here — altering password hashing cost
is a security-relevant change that should be deliberate and reviewed.

### 3. `numpy` held at 1.x
`numpy==1.26.4` cannot move to 2.x while `mediapipe==0.10.14` is in use — the wheels are
built against the numpy 1 ABI. Already documented in `requirements.txt` itself. This
constrains `scipy`, `numba` and `llvmlite` versions too. It is a coupled upgrade, and it is
an ML-adjacent one, so it is out of scope while ML is parked.

### 4. Python 3.11 only
`mediapipe==0.10.14` has no 3.12/3.13 wheels for this pin. Documented in `requirements.txt`.

**No dependency in either manifest was found to have a publicly known critical advisory
affecting the pinned version.** This was assessed from the pins and their documented
constraints, not from a live vulnerability-database query — no scanner was run and this
environment has no network access to advisory feeds. **A real `pip-audit` / `npm audit` run
is an outstanding item, listed as blocked in the run report.**

---

## Backend — direct dependencies

### Web / API
| Package | Version | Purpose |
|---|---|---|
| fastapi | 0.115.6 | HTTP framework |
| uvicorn[standard] | 0.34.0 | ASGI server |
| pydantic | 2.10.4 | Request/response validation |
| pydantic-settings | 2.7.0 | Typed settings from env |
| email-validator | 2.2.0 | Email field validation |
| python-dotenv | 1.0.1 | `.env` loading |

### Database
| Package | Version | Purpose |
|---|---|---|
| SQLAlchemy | 2.0.36 | ORM / core, async |
| asyncpg | 0.30.0 | Postgres driver (Neon) |
| aiosqlite | 0.20.0 | SQLite driver (tests) |
| alembic | 1.14.0 | Migrations (0001–0017) |
| greenlet | 3.1.1 | Required by SQLAlchemy async |

### Auth
| Package | Version | Purpose |
|---|---|---|
| PyJWT | 2.10.1 | Access/refresh tokens |
| passlib | 1.7.4 | Hashing context — **unmaintained, see finding 2** |
| bcrypt | 4.0.1 | Password hashing, 12 rounds |

### Numeric core
| Package | Version | Purpose |
|---|---|---|
| numpy | 1.26.4 | **Held at 1.x — see finding 3** |
| scipy | 1.13.1 | Signal processing |
| scikit-learn | 1.5.2 | The (synthetic-trained) models |
| numba / llvmlite | 0.59.1 / 0.42.0 | librosa acceleration |

### ML — voice
librosa 0.10.2.post1, soundfile 0.12.1, soxr 0.5.0.post1, audioread 3.0.1, pooch 1.8.2,
praat-parselmouth 0.4.5 (jitter/shimmer/HNR; degrades gracefully to `HAS_PRAAT=False`
returning 0.0 rather than failing, if the wheel will not build).

### ML — face
opencv-python 4.10.0.84, mediapipe 0.10.14, protobuf 4.25.3.

**Every model these support is trained on synthetic fixtures** — see `docs/ML_STATUS.md`.
No ML work was done this run; ML is parked.

### Tests
pytest 8.3.4, pytest-asyncio 0.25.0, httpx 0.28.1, anyio 4.7.0.

---

## Frontend — direct dependencies

### Runtime
| Package | Version | Purpose |
|---|---|---|
| react / react-dom | ^18.3.1 | UI |
| react-router-dom | ^7.18.2 | Routing |
| @mediapipe/tasks-vision | ^1.0.1 | On-device FaceMesh / PoseLandmarker — **this is what makes INV-1 possible**: features are extracted here, in the browser, and the media is discarded |
| recharts | ^3.10.1 | Trend charts |
| lucide-react | ^1.31.0 | Icons |
| lenis | ^1.3.26 | Smooth scroll (landing page) |
| clsx / tailwind-merge / class-variance-authority | ^2.1.1 / ^3.6.0 / ^0.7.1 | Class composition |

### Build / dev
vite ^8.2.0, @vitejs/plugin-react ^6.0.4, typescript ~6.0.2, tailwindcss ^3.4.17,
postcss ^8.5.26, autoprefixer ^10.5.4, vite-plugin-pwa ^1.3.0, vitest ^4.1.11,
oxlint ^1.75.0, playwright-core ^1.62.1, @types/* .

**No runtime network dependency is introduced by any of these** — the PWA/offline and
airplane-mode guarantees hold. MediaPipe model assets are cached by the service worker,
which is what makes the offline demo possible (Part 7.4 verification is outstanding).

---

## Outstanding

- Run `pip-audit` and `npm audit` against a live advisory feed. Not possible in this
  environment; listed as blocked in `docs/archive/COMPLETION_RUN_REPORT.md`.
- Decide on finding 2 (migrate off `passlib`). Finding 1 is **done** — see D-052.
