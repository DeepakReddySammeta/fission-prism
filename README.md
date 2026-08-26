# Voyage AI

A conversational trip-planning proof of concept built to showcase the
**[A2UI protocol](https://google-a2a.github.io/A2A/)**-style pattern: agents
generate UI as *data* — a stream of `createSurface` / `updateComponents` /
`updateDataModel` envelopes — and a generic React renderer builds the actual
interface from that stream. No agent ever sends HTML, JSX, or a UI library
component; it sends catalog references and data, and the client decides what
those look like. The LLM can choose *what* to show, never *how it's rendered*
or *what code runs*.

Runs with **zero cost and zero setup** — every agent falls back to
deterministic mock data if no Groq key is present. Add a free Groq API key to
switch agents over to live LLM generation.

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

```
User query
   │
   ├─ "my plans" / "my bookings" ──▶ answered directly from the database (no LLM)
   ├─ "best places to visit..." ───▶ Destinations agent (region + season aware)
   │
   ▼
Intent parser  ──▶  decides which agents to call (flights / hotels / both)
   │
   ▼
Flights Agent, Hotels Agent  (Groq LLM if GROQ_API_KEY set, else deterministic mock data)
   │  build A2UI envelopes
   ▼
Trust boundary (validateEnvelope)  ──▶  drops anything off the component/function catalog
   │
   ▼
SSE stream  ──▶  React renderer (backend/src/types.ts and frontend/src/types.ts
                  are kept identical by hand — see Project layout below)
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

**Backend:** Fastify, TypeScript, better-sqlite3, the Groq SDK (model
`openai/gpt-oss-20b`), bcryptjs, jsonwebtoken, google-auth-library.

**Frontend:** React 18, Vite, TypeScript, Tailwind CSS, the
[Fission design system](https://fissionhq.github.io/ui-design-system/)
(button, input, card, badge, dialog, form, select, table, tabs, toast —
themed with Fission's own default orange palette), react-router-dom,
react-hook-form, jsPDF.

Chosen for a POC that needs to run on a laptop with `npm install` and
nothing else: no database server (SQLite), no billing setup for a demo
(Groq's free tier), and a hand-rolled A2UI renderer small enough that the
security boundary (the component/function allowlist) is easy to read and
verify rather than trusting an opaque dependency with it.

## Project layout

Two independent apps — not an npm workspace. Each has its own
`node_modules` and its own `package.json`.

```
backend/
  src/server.ts          every HTTP route: /api/plan, /api/events (SSE), /api/action, auth, saved plans
  src/agents/             intent.ts, flights.ts, hotels.ts, destinations.ts, recommend.ts — one job each
  src/orchestrator/       sessions.ts (SSE state), envelopes.ts (A2UI UI trees), trust.ts (allowlist)
  src/llm/groq.ts         the single function every agent calls to talk to Groq
  src/weather/weather.ts  live Open-Meteo lookup — deliberately outside the agent pipeline
  src/auth/               email/password + Google auth, JWT sessions
  src/db.ts               SQLite (better-sqlite3) — accounts + saved plans, gitignored data.db
  src/types.ts            A2UI + domain types

frontend/
  src/a2ui/catalog.tsx    the generic renderer — every surface (flights, hotels, rooms, trip
                          summary, destinations, saved plans) goes through this one interpreter
  src/a2ui/store.ts       A2UIStore — per-turn state, consumed via useSyncExternalStore
  src/planner/            PlannerContext (conversations/turns), persistence.ts (localStorage)
  src/components/         TripBuilderCard, WeatherCard, Stepper — hand-built, reused across surfaces
  src/components/ui/      Fission design-system primitives, vendored in via the shadcn CLI (see below)
  src/lib/useVoiceSearch.ts  Web Speech API wrapper
  src/shell/              sidebar, recents/pinned, theme toggle
  src/auth/, src/pages/   auth context/dialog, My Plans gallery + detail, My Bookings
  src/types.ts            the SAME domain types, copied by hand
```

`types.ts` is intentionally duplicated rather than pulled from a shared
package. For two small apps this keeps things simple — no build step for a
third package, no monorepo/workspace symlink resolution to get right. The
cost: if you change a field in one copy, mirror the same edit in the other by
hand (both files carry a comment saying so).

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
cd voyage-ai
npm run install:all    # installs backend/ and frontend/ independently
```

Run both dev servers, each in its own terminal:

```bash
# terminal 1 — http://localhost:8787
npm run dev:backend

# terminal 2 — http://localhost:5173
npm run dev:frontend
```

Open **<http://localhost:5173>** and try: *"Plan a trip from Hyderabad to Goa
for 3 nights"*, *"best hotels in Manali"*, *"flights from Delhi to
Bengaluru"*, or *"best places to visit in India in monsoon"*.

By default every agent runs on **deterministic mock data** — same shapes,
same flow, no API key needed. `GET /api/health` reports `{"llm":"mock"}` in
this mode.

### Enabling live LLM generation (optional)

1. Get a free key at [console.groq.com](https://console.groq.com) (no card
   required).
2. In `backend/`, copy the template and fill in your key:
   ```bash
   cd backend
   cp .env.example .env
   # then edit .env and paste your key after GROQ_API_KEY=
   ```
3. Restart the backend (`npm run dev`). The startup log will say
   `[llm] enabled ... via Groq` instead of `disabled`, and `GET /api/health`
   will report `{"llm":"groq"}`.

`backend/.env` is already in `.gitignore` — it won't get committed. If a live
Groq call ever fails for any reason (bad key, rate limit, network), that one
request falls back to mock data automatically rather than erroring out.

### Accounts, saved plans, and Google sign-in

Email/password sign-in and "My Plans"/"My Bookings" work out of the box —
accounts and saved plans live in `backend/data.db` (SQLite, gitignored,
created automatically on first run). Nothing to configure.

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
  trip summaries, saved-plan lists, and destination suggestions are all
  different data shapes rendered by the exact same generic interpreter
  (`a2ui/catalog.tsx`) — none of them is a hand-coded screen.
- **Structure vs. data separation** — each agent sends `updateComponents`
  once per surface; selecting a flight/hotel/room only sends
  `updateDataModel` or a small components patch, never a full re-render.
- **Template-driven lists** — the flights, hotels, and destinations lists
  are each one template component bound to a data array
  (`List.children = { path, componentId }`), not one component per item.
- **Two-way action routing** — `Button` actions carry resolved data-model
  values back to the server (`context: { flightId: { path: 'id' } }`), and
  the server routes the action to the right in-memory session state.
- **A trust boundary that actually runs** — `orchestrator/trust.ts` checks
  every envelope's component kinds and function-call names against a fixed
  allowlist before it ever reaches the SSE stream, independent of whether
  the data came from an LLM or a mock generator; the client re-checks the
  same allowlist again on the way in.
- **Client-side PDF export** — the trip summary surface is walked directly
  to build a PDF with `jsPDF`, no server round-trip.

## Known limitations (this is a POC, on purpose)

Solid: bcrypt password hashing, parameterized SQL everywhere (no injection
surface), server-verified Google sign-in, protected routes reject
unauthenticated requests before any handler logic runs, and the LLM never
receives PII (email/name/token) in any prompt.

Not production-hardened, deliberately: CORS is wide open (`origin: true`),
the JWT signing secret falls back to a hardcoded dev value if unset, there's
no rate limiting, request validation is ad hoc rather than schema-enforced,
and the auth token lives in `localStorage` rather than an httpOnly cookie.
None of this affects the actual A2UI trust boundary (the envelope allowlist),
which is the part this project exists to demonstrate.

## Deployment (free tier)

- **Frontend → Vercel.** Root directory: `frontend`. Build command:
  `npm run build`. Set env var `VITE_API_URL` to your deployed backend URL.
- **Backend → Render** (free web service). Root directory: `backend`.
  Build command: `npm install && npm run build`. Start command: `npm start`.
  Set `GROQ_API_KEY` there if you want live generation in the deployed
  version, and `JWT_SECRET` to a real random value.

  Render's free tier is used over Vercel serverless functions specifically
  because this app holds a long-lived SSE connection per session — serverless
  function timeouts (10–60s) would cut the stream mid-plan.
