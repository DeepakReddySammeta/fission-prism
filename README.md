# Fission Prism

A conversational proof of concept — **trip planning, find-a-doctor, and
personal finance in one chat** — built to showcase
**[A2UI](https://a2ui.org/)**: agents generate UI as *data* — a stream of
`createSurface` / `updateComponents` / `updateDataModel` envelopes (A2UI
v0.9) — and the official [`@a2ui/react`](https://www.npmjs.com/package/@a2ui/react)
renderer builds the actual interface from that stream. No agent ever sends
HTML, JSX, or a UI library component; it sends catalog references and data,
and the client decides what those look like. The LLM can choose *what* to
show, never *how it's rendered* or *what code runs*.

The frontend registers a small **custom catalog** with the a2ui renderer —
Fission Prism's own component implementations (rendered with the Fission design
system) plus a few logic functions — so the app keeps its own look while the
a2ui engine does the binding, templating, action routing and validation.

Runs with **zero cost and zero setup** — every agent falls back to
deterministic mock data if no LLM credentials are present. Add a free Groq API
key (or point it at AWS Bedrock) to switch the agents that generate content
over to live LLM output; the doctor and finance agents are deterministic
either way (see below).

## Features

- **Conversational trip planning** — "Plan a trip from Hyderabad to Goa for
  3 nights" returns live flights and hotels as interactive cards inside the
  chat, not a redirect to another page.
- **Intent-driven auto-selection** — naming a time, a specific flight, or
  booking language ("book...") pre-selects the matching option with a
  Confirm, while still letting you switch to the full list.
- **Multi-traveler booking with cabin class** — adult/children counts, a real
  Economy / Premium Economy / Business / First choice (each with its own
  price multiplier and baggage allowance), and one name field per adult.
- **Hotels as a card grid** — the hotels list renders as a 2-up grid of
  photo-topped cards; "View rooms" opens that hotel's detail + rooms as its
  own chat turn (not an in-place swap), so the list above stays put.
- **Find a doctor** — describe a symptom ("splitting migraine for two days",
  "toothache") or ask for a specialist ("I need a cardiologist", "find a
  dentist") and get a ranked list of doctors with the hospital they practise
  at, a drill-in profile, and an appointment form → confirmation. The LLM's
  only job is symptom → specialty; matching, hospitals and slots are a
  deterministic lookup over a curated dataset. It never diagnoses, evaluates
  severity, or suggests treatment. "My upcoming appointments" answers inline.
- **Personal finance** — set a budget from a sentence ("I earn 60000, rent is
  20000, food 12000"), log expenses ("spent 500 on groceries"), set and fund
  savings goals, ask for a spending summary or a whole "portfolio" overview
  (cash flow, budget utilisation, recent expenses, goals analysis). Pure
  deterministic extraction over the user's own numbers — no rupee amount is
  ever hallucinated — and every figure is scoped to the signed-in account.
- **App switcher in the sidebar** — an "Apps" panel (Trip Planner /
  Healthcare / Finance) under "New chat"; the one matching the current
  conversation lights up as the reply comes in. Read-only status indicators,
  not navigation.
- **Ordered result streaming** — when a query expects both flights and
  hotels, the two agents stream back independently; the UI holds the hotels
  section (skeleton and all) until flights have rendered, so a fast hotels
  response never strands the flights skeleton mid-page.
- **Destination discovery** — "best places to visit in India in monsoon" or
  "where should I go for 5 days" returns a curated, season-aware list of
  real places to consider (not a flight/hotel search). Each place can be
  explored further (drilling into sub-destinations, recursively) or exited
  into the normal booking flow with one "Schedule a trip" click.
- **Live weather** — an animated, clearly-attributed weather card for the
  actual trip destination, sourced live from Open-Meteo (no API key needed).
  Shown only alongside a real flights/hotels search, never for a bare
  inspiration query.
- **Voice search** — a mic button next to the query box using the browser's
  native Web Speech API; it's nothing more than speech converted to the same
  text a typed query would be. Only renders in browsers that support it
  (Chrome/Edge); no backend involvement at all.
- **Conversational My Plans / My Bookings** — "show my upcoming bookings"
  answers inline in the chat with a real list and drill-into-details,
  typo-tolerant ("bookngs", "resevations" still match).
- **Genuine conversation persistence** — closing and reopening a past
  conversation from Recents restores exactly what was rendered, from
  localStorage — it does not silently re-ask the LLM.
- **Save-before-booking** — a plan can be saved to "My Plans" at any point,
  not only after a booking completes.
- **PDF export** of a confirmed trip's full booking breakdown.
- **Email/password and Google sign-in**, with guest trip planning still
  fully usable without an account.
- **Dark mode**, toggled and persisted client-side.

## Architecture

```text
User query
   │
   │  fast deterministic classifiers run first — no LLM, no session:
   ├─ "my plans" / "my bookings" ─────▶ answered directly from the database
   ├─ "my appointments" ──────────────▶ appointments lookup (database)
   ├─ "budget / spent / portfolio…" ──▶ Finance agent (regex/heuristic extraction)
   ├─ "best places to visit…" ────────▶ Destinations agent (region + season aware)
   ├─ "View rooms at <hotel>" ────────▶ jump straight to that hotel's rooms
   │
   ▼
Intent parser  ──▶  plan_trip / browse_flights / browse_hotels / find_doctor / refine
   │                 (Groq or AWS Bedrock, per LLM_PROVIDER; heuristic fallback)
   │
   ├─ find_doctor ──▶ Health agent: LLM maps symptom → specialty, then a
   │                  deterministic match over curated doctors + hospitals
   ▼
Flights Agent, Hotels Agent  (live LLM if configured, else deterministic mock data)
   │  build A2UI envelopes
   ▼
Trust boundary (validateEnvelope)  ──▶  drops anything off the component/function catalog
   │
   ▼
Wire reducer (reduceForWire)  ──▶  createSurface once per surface; updateComponents
   │                                only carries components whose JSON changed
   ▼
SSE stream  ──▶  @a2ui/react MessageProcessor + Voyage's custom catalog
                  (frontend/src/a2ui/) — the client re-checks the allowlist too
```

Weather is deliberately **not** part of this pipeline: it's a plain
`GET /api/weather` the frontend calls directly once a real booking
destination is known, rendered as its own visually-distinct card (dashed
border, "Live weather from Open-Meteo — not a saved trip record") so a live
third-party reading is never mistaken for one more governed result sitting
next to it.

**Why the LLM generates domain data, not raw protocol JSON:** agents ask Groq
for `FlightOption[]` / `HotelOption[]` / `DestinationSuggestion[]` — plain
data — and our own code builds the A2UI envelope from that data
deterministically. This is safer than asking an LLM to freehand full
protocol JSON while still using the LLM for the part that actually needs
generation: inventing realistic options. The trust-boundary validator still
runs on every envelope regardless, so the safety property holds even if that
changes later. The LLM never sees a user's email, name, or auth token — every
call carries only the raw query text or a bare origin/destination string.

## Tech stack

**Backend:** Fastify, TypeScript, better-sqlite3, two interchangeable LLM
backends — the Groq SDK (default, model `openai/gpt-oss-20b`) and
`@anthropic-ai/bedrock-sdk` (a Claude model on AWS Bedrock) — bcryptjs,
jsonwebtoken, google-auth-library.

**Frontend:** React 19, Vite, TypeScript, Tailwind CSS,
[`@a2ui/react`](https://www.npmjs.com/package/@a2ui/react) +
[`@a2ui/web_core`](https://www.npmjs.com/package/@a2ui/web_core) (the A2UI
v0.9 renderer + engine), `zod` (component schemas), the
[Fission design system](https://fissionhq.github.io/ui-design-system/)
(button, input, card, badge, dialog, form, select, table, tabs, toast —
themed with Fission's own default orange palette), react-router-dom,
react-hook-form, jsPDF.

Chosen for a POC that needs to run on a laptop with `npm install` and
nothing else: no database server (SQLite), no billing setup for a demo
(Groq's free tier). The A2UI rendering is the real published library, driven
by a **custom catalog** (`frontend/src/a2ui/`) so the app looks the way it
wants; the security boundary stays legible because it's small and lives in
two obvious places — `backend/src/orchestrator/trust.ts` (server-side, every
envelope) and `A2uiRuntime.sanitizeEnvelope` (client-side re-check), and any
component the catalog doesn't define renders as an inert placeholder, never
code.

## Project layout

Two independent apps — not an npm workspace. Each has its own
`node_modules` and its own `package.json`.

```text
backend/
  src/server.ts          every HTTP route: /api/plan, /api/events (SSE), /api/action, auth, saved plans
  src/agents/             intent.ts, flights.ts, hotels.ts, destinations.ts,
                          health.ts (doctor/appointment matching), finance.ts (budget/expense/goal
                          extraction), recommend.ts — one job each
  src/orchestrator/       sessions.ts (SSE state + reduceForWire delta emit),
                          envelopes.ts (A2UI UI trees), trust.ts (allowlist),
                          hotelIndex.ts (name lookup for "View rooms at X" / "details of X hotel")
  src/llm/                index.ts (generateJSON — the single function every content agent calls),
                          groq.ts / bedrock.ts (interchangeable backends, pick via LLM_PROVIDER)
  src/mock/               curated datasets used both as the no-LLM fallback and as the
                          fixed source of truth for doctors/hospitals/finance
  src/weather/weather.ts  live Open-Meteo lookup — deliberately outside the agent pipeline
  src/auth/               email/password + Google auth, JWT sessions
  src/db.ts               SQLite (better-sqlite3) — accounts, saved plans, expenses, goals,
                          appointments. Path is DATABASE_PATH or backend/data.db (gitignored)
  src/config.ts           all env vars in one place; enforces JWT_SECRET when NODE_ENV=production
  src/types.ts            A2UI protocol + domain types (the full copy)

frontend/
  src/a2ui/apis.ts        Zod schema per component — what the a2ui generic binder reads
  src/a2ui/components.tsx  Fission Prism's component implementations (rendered with Fission)
  src/a2ui/functions.ts   logic functions (formatCurrency, formatDuration, required, ...)
  src/a2ui/catalog.ts     assembles the Catalog handed to @a2ui/react
  src/a2ui/runtime.ts     A2uiRuntime — wraps MessageProcessor: allowlist re-check,
                          message log for replay, useSyncExternalStore glue, read helpers
  src/a2ui/Surface.tsx    <A2uiSurface> inside the Fission card shell
  src/planner/            PlannerContext (conversations/turns), persistence.ts (localStorage)
  src/components/         TripBuilderCard, WeatherCard, Stepper — hand-built, reused across surfaces
  src/components/ui/      Fission design-system primitives, vendored in via the shadcn CLI (see below)
  src/lib/useVoiceSearch.ts  Web Speech API wrapper
  src/shell/              sidebar, recents/pinned, theme toggle,
                          apps.ts (the Apps panel list + which app a turn belongs to)
  src/auth/, src/pages/   auth context/dialog, My Plans gallery + detail, My Bookings
  src/types.ts            domain shapes + CATALOG_ID only — A2UI protocol types
                          now come from @a2ui/web_core
```

The two `types.ts` files still share their **domain** shapes (`FlightOption`,
`TripSummary`, ...) by hand-copying rather than a shared package — no build
step for a third package, no workspace symlinks. If you change a domain field
in one, mirror it in the other. The A2UI *protocol* types are no longer
duplicated: the backend builds envelopes against its own copy, the frontend
gets them from `@a2ui/web_core`.

## Design system (Fission)

The frontend's UI primitives and color theme both come from
[Fission](https://fissionhq.github.io/ui-design-system/) — but it's a
shadcn-compatible **registry**, not an npm package: the shadcn CLI copies
Fission's component source directly into `src/components/ui/`, and there's
no `fission-ui` entry in `package.json` to `npm update`. That means new
Fission releases don't reach this repo automatically — pull them by hand
with the commands below.

### Updating the components

Fission publishes a plain registry manifest and one JSON file per
component:

```bash
# see what Fission currently ships (adjust if the item list ever grows)
curl -s https://fissionhq.github.io/ui-design-system/registry.json | jq '.items[].name'
```

To pull the latest version of everything currently in use:

```bash
cd frontend
npx shadcn@latest add \
  https://fissionhq.github.io/ui-design-system/r/badge.json \
  https://fissionhq.github.io/ui-design-system/r/button.json \
  https://fissionhq.github.io/ui-design-system/r/card.json \
  https://fissionhq.github.io/ui-design-system/r/dialog.json \
  https://fissionhq.github.io/ui-design-system/r/form.json \
  https://fissionhq.github.io/ui-design-system/r/input.json \
  https://fissionhq.github.io/ui-design-system/r/select.json \
  https://fissionhq.github.io/ui-design-system/r/table.json \
  https://fissionhq.github.io/ui-design-system/r/tabs.json \
  https://fissionhq.github.io/ui-design-system/r/toast.json \
  --yes --overwrite
```

The CLI diffs against what's already there — it reports which files it
skipped (identical), updated, or created, and installs any new npm
dependency a component needs on its own. To add a component Fission ships
but this app doesn't use yet, just add its URL to the list (or run the
command with only that one URL).

### Updating the theme

There's no CLI for this part — Fission's color values live in their site's
compiled CSS, not in the registry JSON. To re-sync:

```bash
curl -s https://fissionhq.github.io/ui-design-system/ \
  | grep -oE '_next/static/css/[a-z0-9]+\.css' # find the current CSS bundle path
curl -s https://fissionhq.github.io/ui-design-system/<path-from-above> -o /tmp/fission.css
grep -oE ':root(\[data-theme=fission\])?\{[^}]*\}|\.dark\{[^}]*\}' /tmp/fission.css
```

That prints Fission's current `:root`/`:root[data-theme=fission]` (light)
and `.dark` (dark) values. Copy the hex values across into the matching
variable **names** already in `frontend/src/styles.css`'s `:root` and
`.dark` blocks (`--navy`, `--brass`, `--paper`, `--ink`, `--muted`, `--rule`,
`--success`, `--color-brand-hover`, `--color-brand-active`, ...) — the
names stay put on purpose, since every other hand-authored rule in that file
references them; only the values need to change to pick up a new Fission
release. Two things a plain value-swap won't catch, so check both by hand
after updating:

- **Hardcoded color literals.** A few places write a brand-tinted
  `rgba(r, g, b, alpha)` directly (focus rings, the mic-button pulse
  animation, the hero-flourish glow) instead of `var(--brass)`, so they
  won't repaint on their own — `grep -n "rgba(242, 80, 17" frontend/src/styles.css`
  finds today's set; update them to match whatever the new brand RGB is.
- **Backend-sent surface colors.** `backend/src/orchestrator/envelopes.ts`'s
  `createSurface(...)` calls hardcode a hex string per surface (the card's
  top-border color, sent to the client in the envelope's `theme.primaryColor`)
  — `grep -n "createSurface(" backend/src/orchestrator/envelopes.ts` finds
  every one that needs updating too.

Fission also ships four alternate palettes besides the default orange
(`ocean` blue, `forest` green, `violet` purple, `slate` gray) — same
`grep`, just against `:root[data-theme=ocean]` etc., if the brand color
ever needs to change again.

After either kind of update: `cd frontend && npx tsc --noEmit`, then eyeball
the composer, a flights/hotels search, and dark mode before calling it done.

## Prerequisites

- **Node.js 20+** and npm (developed against Node 20.20).
- Nothing else — no database server, no Docker, no API key required to run
  it (see below for what a Groq key adds).

## Setup, from scratch

```bash
git clone <this-repo-url>
cd fission-prism
npm run install:all    # installs backend/ and frontend/ independently
```

Run both dev servers, each in its own terminal:

```bash
# terminal 1 — http://localhost:8787
npm run dev:backend

# terminal 2 — http://localhost:5173
npm run dev:frontend
```

Open **<http://localhost:5173>** and try:

- *"Plan a trip from Hyderabad to Goa for 3 nights"*, *"best hotels in
  Manali"*, *"flights from Delhi to Bengaluru"*
- *"best places to visit in India in monsoon"*
- *"I've had a splitting migraine for two days, find me a doctor"*, *"find a
  dentist"*, *"my upcoming appointments"*
- *"I earn 60000, rent is 20000, food 12000"*, *"spent 500 on groceries"*,
  *"give me my portfolio"*

By default every agent runs on **deterministic mock data** — same shapes,
same flow, no API key needed. `GET /api/health` reports `{"llm":"mock"}` in
this mode (or `{"llm":"groq"|"bedrock","model":"…"}` once configured).

### Enabling live LLM generation (optional)

Only the agents that *invent content* use the LLM: intent parsing, and the
flights / hotels / destinations generators. The doctor agent uses the LLM for
one narrow step (symptom → specialty string) and is otherwise a deterministic
lookup; the finance agent uses no LLM at all. So a missing key degrades the
travel demo to fixed sample data — it doesn't break health or finance.

The content agents talk to one of two interchangeable providers, selected by
`LLM_PROVIDER` in `backend/.env` (`cp .env.example .env` first):

- **`groq`** (default) — get a free key at
  [console.groq.com](https://console.groq.com) (no card required) and set
  `GROQ_API_KEY`.
- **`bedrock`** — a Claude model on AWS Bedrock. Set `LLM_PROVIDER=bedrock`,
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, and optionally
  `BEDROCK_MODEL` (default `us.anthropic.claude-sonnet-5`). Use
  `AWS_SESSION_TOKEN` too if your credentials are temporary/STS.

Restart the backend (`npm run dev`). The startup log will say
`[llm] enabled ... via <provider>` instead of `disabled`, and `GET /api/health`
will report `{"llm":"<provider>","model":"..."}`.

`backend/.env` is already in `.gitignore` — it won't get committed. If a live
LLM call ever fails for any reason (bad key/credentials, rate limit, network),
that one request falls back to mock data automatically rather than erroring out.

### Accounts, saved plans, and Google sign-in

Email/password sign-in and "My Plans"/"My Bookings" work out of the box —
accounts, saved plans, logged expenses, savings goals, and appointments all
live in `backend/data.db` (SQLite, gitignored, created automatically on first
run). Nothing to configure. Set `DATABASE_PATH` to move that file elsewhere
(e.g. a mounted volume in production); its directory is created if missing.

Google sign-in is optional and hidden until configured: create an OAuth
Client ID at
[Google Cloud Console](https://console.cloud.google.com/apis/credentials)
(type "Web application", add `http://localhost:5173` under "Authorized
JavaScript origins"), then set the same value as `GOOGLE_CLIENT_ID` in
`backend/.env` and `VITE_GOOGLE_CLIENT_ID` in `frontend/.env` (copy
`frontend/.env.example` to `frontend/.env` first). The "Continue with
Google" button appears once both are set.

### Voice search

No setup needed — it uses the browser's built-in `SpeechRecognition` API.
The mic button next to the query box only appears in browsers that support
it (Chrome, Edge); it's simply absent elsewhere rather than showing a
non-functional button.

## What this demonstrates about A2UI

- **Agent-generated UI, not agent-generated text.** Flights, hotels, rooms,
  trip summaries, saved-plan lists, destination suggestions, doctor lists and
  profiles, appointment forms, and every finance card (budget breakdown,
  expense confirmation, goal tracker, portfolio) are all different data
  shapes rendered by the same `@a2ui/react` engine over one small custom
  catalog — none of them is a hand-coded screen.
- **The real renderer.** The client is `@a2ui/react`'s `MessageProcessor` +
  `A2uiSurface` + generic binder, not a bespoke interpreter — the same code
  path any A2UI client would use. Fission Prism only supplies the *catalog*
  (component implementations + logic functions).
- **Structure vs. data separation, on the wire.** `reduceForWire`
  (`orchestrator/sessions.ts`) sends `createSurface` exactly once per
  surface and, when an action rebuilds a whole surface tree, puts only the
  components that actually changed on the SSE stream. Pure data changes are
  a lone `updateDataModel`.
- **Template-driven lists** — the flights, hotels, and destinations lists
  are each one template component bound to a data array
  (`List.children = { path, componentId }`), not one component per item.
- **Two-way action routing** — `Button` actions carry resolved data-model
  values back to the server (`context: { flightId: { path: 'id' } }`), and
  the server routes the action to the right in-memory session state.
- **A trust boundary that actually runs** — `orchestrator/trust.ts` checks
  every envelope's component kinds and function-call names against a fixed
  allowlist before it reaches the SSE stream, independent of whether the
  data came from an LLM or a mock generator; `A2uiRuntime` re-checks the
  catalog on the way in, and any unknown component renders as an inert
  placeholder rather than executing anything.
- **Reactive validation** — a `Button`'s `checks` array is evaluated by the
  binder into `isValid` / `validationErrors`; e.g. "Confirm booking" stays
  disabled (with a reason on hover) until the lead-guest field is filled.
- **Client-side PDF export** — the confirmed trip's structured data is
  fetched (`GET /api/trip/:id`) and turned into a branded multi-section PDF
  with `jsPDF`, entirely in the browser.

## Known limitations (this is a POC, on purpose)

Solid: bcrypt password hashing, parameterized SQL everywhere (no injection
surface), server-verified Google sign-in, protected routes reject
unauthenticated requests before any handler logic runs, and the LLM never
receives PII (email/name/token) in any prompt.

Not production-hardened, deliberately: CORS is wide open (`origin: true`),
the JWT signing secret falls back to a hardcoded dev value when unset (the
server does refuse to start with that default once `NODE_ENV=production`),
there's no rate limiting, request validation is ad hoc rather than
schema-enforced, and the auth token lives in `localStorage` rather than an
httpOnly cookie. None of this affects the actual A2UI trust boundary (the
envelope allowlist), which is the part this project exists to demonstrate.

## Deployment (free tier)

- **Frontend → Vercel.** Root directory: `frontend`. Build command:
  `npm run build`. Set env var `VITE_API_URL` to your deployed backend URL.
- **Backend → Render** (free web service). Root directory: `backend`.
  Build command: `npm install && npm run build`. Start command: `npm start`.
  Env vars:
  - `NODE_ENV=production` — required; turns on the `JWT_SECRET` startup check.
  - `JWT_SECRET` — a real random value
    (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`).
  - `DATABASE_PATH` — point at a mounted persistent disk (e.g. `/data/data.db`)
    so accounts and saved data survive a redeploy; without a disk the free
    tier wipes the SQLite file on every restart.
  - `GROQ_API_KEY` (or the `LLM_PROVIDER=bedrock` + AWS vars) for live
    generation — optional; it falls back to mock data otherwise.

  Render's free tier is used over Vercel serverless functions specifically
  because this app holds a long-lived SSE connection per session — serverless
  function timeouts (10–60s) would cut the stream mid-plan.
