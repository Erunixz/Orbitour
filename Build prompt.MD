Build Prompt: 3D Stop-by-Stop Trip Planner

Paste everything below this line into your coding agent.

0. Who you are and how we work

You are a senior full-stack engineer building a new web app from scratch in this empty project folder. The app is called [APP_NAME] (use this placeholder everywhere until I give you a real name).

Hard rules (read these first, follow them always)
Git is mine. Do NOT run any git command that changes the repo: no git init, add, commit, push, branch, checkout -b, merge, rebase, reset, stash, tag, and no creating PRs. You may only run read-only git status and git diff if a repo already exists. When a phase is done, tell me it's ready and I will commit it myself.
This is an original project, not a fork. Nothing in this codebase (code, comments, README, package name, UI text, commit suggestions, file headers) may say it is a fork, port, clone, or copy of any other project, and nothing may mention the reference project's name.
Reference, don't copy. The reference repository (section 2) has no license file, which means its code is not licensed for reuse. Read it to understand architecture, APIs, and pitfalls, then write your own implementation in your own words and structure. Never paste code from it, never copy files or prompts from it, never import from it, and never mirror its file-by-file layout or naming verbatim.
Keep the reference outside the project. If you need to read it, clone it into a sibling folder outside this project (for example ../_reference/). Never place it inside this project, never add it as a dependency or submodule.
Secrets. Never print, log, or hardcode API keys. Never edit my real .env; only create and update .env.example. Server-only keys must never reach the browser bundle.
Paid APIs. Never write loops, tests, or scripts that call Google Tiles, Google Routes, or OpenAI repeatedly. Tests use mocks and fixtures. Ask me before running anything that calls a paid API more than a few times.
Dependencies. Use the stack in section 4. Ask me before adding any dependency not listed there.
Work in phases (section 12). At the end of each phase: stop, summarize what changed, list the files touched, explain exactly how I test it, and wait for me to say continue.
Before coding each phase, briefly state your plan for that phase.
Writing style for UI copy, comments, and docs: plain and short. Do not use em dashes anywhere.
1. Product summary

A trip planner where the 3D city is the interface.

The user names a city and describes the trip (days, pace, interests, travel mode, start/end times, budget, who's travelling, must-see places).
A "crew" (a fixed pipeline of code tools plus two LLM agents) builds a realistic multi-day itinerary on real streets, with real travel times.
The user sees the plan on photorealistic Google 3D Tiles: numbered pins on real rooftops, routes drawn along real streets, a day-by-day sidebar.
The user moves through the plan one stop at a time with Next/Back (or by clicking a stop). Each move is a short, smooth camera flight from the current stop to the next one, then the camera settles on the new stop and an info card appears.
The user can edit the plan (reorder, remove, add stops, or type a change like "drop the museum, slower morning") and the plan is rescheduled.
Trips are saved and can be reopened later.
Explicitly NOT in this app
No narration, no scripted guide text, no text-to-speech, no voice, no mascot/guide character.
No continuous automatic tour or timeline playback. The camera only moves when the user asks it to.
No LLM camera direction or vision models.
No VR/headset app.
No voice input or chat Q&A (can be a later add-on, not now).
2. The reference project

Reference repo (read-only, for learning): https://github.com/Feiyang0303/Orion_HTN26 Its write-up: https://devpost.com/software/project-atlas-icfow4

It is a hackathon project that plans trips with an agent crew and then flies a narrated tour. We keep the planning ideas and the 3D map, and drop everything about narration, voice, and the automatic tour.

Reference files worth reading (understand, then reimplement)

Data model and config

src/types.ts: trip request shape (city, wants, times, pace, transport, party, budget, meals, days, diet), Stop, Leg, LegStep, Source, Photo. Notice they keep sources/attribution on every stop and mark estimated legs.
.env.example: which keys exist and which are browser vs proxy only.
vercel.json, api/index.js: single serverless function that routes all /api/* calls, long function timeout.

Planning pipeline (the part we keep)

src/plan/pipeline.ts: orchestration. Ignore every narration, audio, and TTS part of it.
src/plan/crew.ts: candidate finding, trip radius by number of days, matching the user's must-see places.
src/plan/scout.ts: how the Scout LLM is asked for picks.
src/plan/critic.ts: the LLM critic. Note it only judges what numbers can't (fit to interests, duplicates, suitability for the party). Its prompt assumes a narrated flight; ours must not.
src/plan/timekeeper.ts: visit durations by kind/pace/party, day windows, meals, audit before the critic runs, schedule math.
src/plan/router.ts: Google Routes matrix, best visiting order, per-leg mode choice from distance and budget, and an honest straight-line fallback marked estimated when routing fails.
src/plan/wikipedia.ts: nearby notable articles, title resolution, rejecting things that are not destinations, photos with credits.
src/plan/osm.ts: food and lodging from Overpass, with a "service down" error type.
src/plan/geocode.ts: Nominatim geocode, suggest, reverse, nearby.
src/plan/weather.ts: Open-Meteo forecast.
src/plan/json.ts: asking an LLM for JSON with validation and a retry.
src/plan/events.ts, src/plan/ui/CrewStage.tsx: progress events shown as crew members working.
src/plan/session.ts: planning session state and revisions.
src/plan/ui/Kickoff.tsx, TripView.tsx, SavedTrips.tsx: request form, itinerary view, saved trips list.

3D map (the part we keep)

src/fly/GoogleTiles.tsx: loading Google Photorealistic 3D Tiles with 3d-tiles-renderer in React Three Fiber, the auth/compression/fade/reorientation plugins, required attribution overlay, a cheap key probe, stable plugin args (a fresh object each render tears the auth plugin down), anisotropic filtering.
src/fly/MapRig.tsx: the closest thing to our main screen. Pins on rooftops, routes along streets, the camera easing to whatever is in focus (city, day spread, one stop).
src/fly/RouteLine.tsx, src/fly/ground.ts, src/fly/legStyle.ts, src/fly/routePath.ts, src/fly/geo.ts: drawing routes on the ground, raycasting to find surface height, smoothing, resampling.
src/fly/quality.ts: quality/performance settings.
src/fly/Flythrough.tsx: skim only for how the camera interpolates between points. Ignore everything tied to audio and the tour timeline.

Server/proxy

scripts/proxy.mjs: how API keys stay server-side, the route table (/api/llm, /api/wiki, /api/overpass, /api/routes/matrix, /api/routes/walk, /api/health), error handling.
scripts/wiki.mjs, scripts/overpass.mjs: response caching (and using /tmp on serverless because the deploy is read-only). Overpass mirrors for failover.
scripts/trips.mjs, src/trips/store.ts: MongoDB trip storage with an in-memory fallback when no URI is set.

Dev fixtures

src/fly/dev/mockPlan.ts, scripts/make-fixture.ts, public/plans/: planning once and saving the result so UI work doesn't spend API quota.
Reference files to ignore completely

src/plan/narrator.ts, src/plan/tts.ts, src/plan/sentences.ts, src/fly/director.ts, src/fly/director.vision.ts, src/fly/directing.ts, src/fly/DirectorDesk.tsx, src/fly/shots.ts, src/fly/timeline.ts, src/fly/Goose.tsx, src/fly/guide.ts, src/fly/GuideTalk.tsx, src/fly/quack.ts, src/fly/useListening.ts, src/fly/FlightHud.tsx, the whole quest/ folder, and the ElevenLabs parts of the proxy.

Lessons from the reference write-up to apply
All timing and routing is done in code, never by the LLM.
The pipeline is fixed; agents do not choose tools.
Every Scout pick must be verified against a real source with coordinates inside the trip area, or it is dropped.
Critic complaints name which crew member must fix them, and that complaint goes into that member's next prompt.
An automated test once burned a full day of Google tile quota in under two minutes by setting a tileset property inside a render loop, which reloads the whole city every frame. Never mutate tileset properties per frame. Add quota caps.
Retry rate-limited (429) upstream calls with backoff instead of treating them as failures.
Validate LLM JSON in code and retry once with a larger token budget if the reply was cut off.
3. External documentation (use these as the source of truth)

Google Maps Platform

Photorealistic 3D Tiles: https://developers.google.com/maps/documentation/tile/3d-tiles
Map Tiles API policies (attribution rules, caching limits): https://developers.google.com/maps/documentation/tile/policies
Routes API overview: https://developers.google.com/maps/documentation/routes
Compute a route (directions v2): https://developers.google.com/maps/documentation/routes/compute_route_directions
Compute a route matrix: https://developers.google.com/maps/documentation/routes/compute_route_matrix
Field masks (required on every Routes request): https://developers.google.com/maps/documentation/routes/choose_fields
Encoded polyline format: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
API key restrictions: https://developers.google.com/maps/api-security-best-practices
Quotas and capping usage: https://developers.google.com/maps/documentation/tile/usage-and-billing

Endpoints: https://tile.googleapis.com/v1/3dtiles/root.json, https://routes.googleapis.com/directions/v2:computeRoutes, https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix.

3D rendering

3DTilesRendererJS (renderer, React Three Fiber components, plugins incl. Google auth, reorientation, compression, fade): https://github.com/NASA-AMMOS/3DTilesRendererJS (read its README and its r3f and plugins docs in the repo)
React Three Fiber: https://r3f.docs.pmnd.rs
Drei helpers (Html for pin labels): https://drei.docs.pmnd.rs
three.js docs: https://threejs.org/docs/
Draco decoder hosted by Google: https://www.gstatic.com/draco/versioned/decoders/1.5.7/

Open data

Wikipedia REST API (page summary, media): https://en.wikipedia.org/api/rest_v1/
MediaWiki GeoSearch (articles near a point): https://www.mediawiki.org/wiki/API:Geosearch
Wikimedia API etiquette (User-Agent requirement): https://www.mediawiki.org/wiki/API:Etiquette
Overpass API: https://wiki.openstreetmap.org/wiki/Overpass_API
Overpass QL: https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL
Nominatim search API: https://nominatim.org/release-docs/latest/api/Search/
Nominatim usage policy (max 1 request/second, User-Agent, caching): https://operations.osmfoundation.org/policies/nominatim/
OSM attribution: https://www.openstreetmap.org/copyright
Open-Meteo forecast API: https://open-meteo.com/en/docs

LLM

OpenAI Chat Completions: https://platform.openai.com/docs/api-reference/chat
Structured outputs (JSON schema responses): https://platform.openai.com/docs/guides/structured-outputs
Rate limits and retries: https://platform.openai.com/docs/guides/rate-limits

App, server, data

Vite: https://vite.dev/guide/
React: https://react.dev
TypeScript: https://www.typescriptlang.org/docs/
Zod: https://zod.dev
MongoDB Node.js driver: https://www.mongodb.com/docs/drivers/node/current/
MongoDB Atlas free cluster: https://www.mongodb.com/docs/atlas/getting-started/
Server-Sent Events: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
Vercel Functions: https://vercel.com/docs/functions
Vitest: https://vitest.dev
Google Maps URLs (directions deep links): https://developers.google.com/maps/documentation/urls/get-started

Optional (only if I ask later)

Sentry for React: https://docs.sentry.io/platforms/javascript/guides/react/
Sentry for Node: https://docs.sentry.io/platforms/javascript/guides/node/

If any doc contradicts what I wrote here, follow the doc and tell me.

4. Tech stack
Area	Choice
Language	TypeScript, strict: true, no any in core types
Frontend	React 19, Vite
3D	three, @react-three/fiber, @react-three/drei, 3d-tiles-renderer
Animation (UI panels)	CSS transitions, or motion if needed
Server	Node 20+, a small HTTP server (Express or plain node:http) that also runs as one Vercel function
Validation	zod for every LLM output, API request body, and upstream response we depend on
LLM	OpenAI Chat Completions with JSON schema output, called only from the server
Storage	MongoDB Atlas via the official driver, with an in-memory fallback when MONGODB_URI is empty
Tests	Vitest
Dev	concurrently to run web and server with one npm run dev

Project layout (you decide the details, keep it clean and your own):

/src            React app
  /map          3D tiles, pins, routes, camera
  /trip         itinerary UI, stop card, editing
  /plan-ui      request form, crew progress
  /lib          shared types, geo math, polyline, time utils
/server         HTTP server, routes, pipeline, upstream clients, cache, store
/server/pipeline  surveyor, scout, verifier, clusterer, router, timekeeper, critic, replan
/api            Vercel entry that forwards to the server handler
/fixtures       saved sample trips for offline UI work
/tests
5. Environment variables

Create .env.example with comments:

# Browser (Vite exposes VITE_* publicly). Map Tiles API only. Restrict by HTTP referrer.
VITE_GOOGLE_TILES_KEY=

# Server only. Never prefix with VITE_.
GOOGLE_ROUTES_KEY=          # Routes API only, restricted by API
OPENAI_API_KEY=
LLM_MODEL_SCOUT=            # reasoning-capable model
LLM_MODEL_CRITIC=           # can match scout
LLM_MODEL_FAST=             # cheap model for replan parsing
MONGODB_URI=                # empty = in-memory store
MONGODB_DB=tripplanner
CONTACT_EMAIL=              # used in User-Agent for Nominatim/Wikipedia
PORT=8787

# Cost guards
DAILY_TRIP_LIMIT=20         # plans per day per IP
DAILY_TILE_SESSIONS=50      # 3D sessions per device per day (client-side guard)

The server must start and serve /api/health even with keys missing, and health must report which keys are missing (never their values).

6. Data model

Design your own types. They must cover at least:

ts
type LatLon = { lat: number; lon: number }

type Source = { kind: 'wikipedia' | 'osm' | 'routes' | 'nominatim'; label: string; url: string }
type Photo  = { url: string; credit: string; pageUrl: string }

type TravelMode = 'walk' | 'transit' | 'drive' | 'cycle'
type Pace = 'relaxed' | 'normal' | 'packed'
type Party = 'solo' | 'couple' | 'family' | 'easy'
type Budget = 'free' | 'modest' | 'any'

type TripRequest = {
  city: string
  days: number                 // 1 to 7
  startTime: string            // "09:30"
  endTime: string              // "18:00"
  startFrom?: string           // hotel or station, free text
  mustSee: string[]            // free text lines, as typed
  interests: string[]
  pace: Pace
  mode: TravelMode | 'auto'
  party: Party
  budget: Budget
  meals: ('lunch' | 'dinner')[]
  diet?: string
}

type StopKind = 'sight' | 'museum' | 'park' | 'viewpoint' | 'market' | 'food' | 'lodging' | 'other'

type Stop = LatLon & {
  id: string
  name: string
  kind: StopKind
  summary: string              // from Wikipedia or OSM, NOT LLM written
  reason: string               // short Scout reason why it fits the request
  photo: Photo | null
  sources: Source[]
  visitMin: number
  arrive: string               // "HH:MM"
  depart: string
  mustSee: boolean             // user asked for it by name
  groundHeightM?: number       // filled client-side by raycast, cached
}

type Leg = {
  fromId: string; toId: string
  mode: TravelMode
  minutes: number; meters: number
  polyline: string             // Google encoded polyline
  estimated: boolean           // true = straight-line fallback
  steps?: { mode: 'walk' | 'transit'; meters: number; minutes: number; line?: string }[]
}

type Day = { index: number; date?: string; stops: Stop[]; legs: Leg[]; warnings: string[] }

type Trip = {
  id: string
  title: string
  request: TripRequest
  center: LatLon
  radiusM: number
  days: Day[]
  lodging?: Stop
  createdAt: string; updatedAt: string
  version: number              // schema version for migrations
}

A trip is stored as a single MongoDB document and always loaded and saved whole.

7. Planning pipeline (server)

Fixed order. Agents never pick tools. The LLM never does arithmetic, never invents coordinates, and never writes times.

Surveyor (code): geocode the city (Nominatim), get center and bounding area; trip radius grows with number of days, capped. Geocode startFrom and each mustSee line, keeping what the user typed next to what it resolved to.
Candidate pool (code): nearby notable Wikipedia articles (GeoSearch) inside the radius, filtered to real destinations (drop streets, districts, companies, people, events).
Scout (LLM): given the request, the candidate pool (titles + one-line descriptions + kind), and any critic feedback, return JSON picks: title, kind, reason, suggested importance. It may only pick from the pool or name must-see places. Ask for more than needed.
Verifier (code): every pick must resolve to a real Wikipedia article (or OSM feature for food/lodging) with coordinates inside the radius. Anything else is dropped and logged as rejected with a reason. Attach summary, photo with credit, and sources.
Food and lodging (code): Overpass for restaurants/cafes near each day's midday and evening stops (respect diet if possible) and one lodging option. Use mirror failover.
Day split (code): cluster stops by geography so each day is compact; must-see stops are always kept.
Router (code): route matrix for each day, best visiting order (brute force for small days, nearest neighbour plus 2-opt otherwise), choose mode per leg from distance and budget when mode is auto, then compute each leg's polyline. On routing failure use a straight-line leg with a detour factor and mode speed, marked estimated.
Timekeeper (code): visit minutes by kind, pace, and party; insert meals at sensible times; compute arrive/depart; run an audit (overruns end time, too many stops, huge legs). Overruns are fixed in code first (drop lowest-importance non-must-see stop, then reschedule) before the critic sees the plan.
Critic (LLM): sees the request and the scheduled plan with the audit report. Only judges what numbers can't: does the day match the stated interests, near-duplicate stops, wrong for the party (e.g. scattered and steep for someone taking it easy), a must-see handled badly. Returns { ok: boolean, issues: [{ target: 'scout' | 'timekeeper', stopId?: string, complaint: string }] }. Its prompt must describe our app accurately: a planner the user explores stop by stop, not a narrated tour.
Revision loop: route each complaint into the target's next run. Maximum 2 loops, then accept and attach remaining issues as day warnings.
Save and return the trip.
LLM call rules
One small wrapper for all LLM calls: system prompt, user payload, JSON schema, per-agent max token budget, timeout, zod validation.
If the reply is invalid or truncated, retry once with a larger budget. If it still fails, fail that stage clearly.
429 and 5xx: retry with exponential backoff and jitter, max 3 tries.
Log per call: agent name, model, latency, input/output tokens. Never log keys or the full user request.
Prompts are written by you, live in their own files, and are short and specific.
Progress streaming

POST /api/trips streams Server-Sent Events: { stage, status: 'start' | 'progress' | 'done' | 'error', message, data? } for each crew member, then a final trip event. The client shows each crew member as a card that lights up while working, labels which ones are LLM agents and which are plain code, and shows rejected picks and critic complaints as they happen.

Caching

Cache Nominatim, Wikipedia, Overpass, and Routes responses by normalized key with a TTL (Mongo collection, with in-memory or /tmp fallback). Respect Nominatim's 1 request/second limit with a queue. Send a proper User-Agent with CONTACT_EMAIL to Nominatim and Wikimedia.

8. Replanning and editing
Manual edits (PATCH /api/trips/:id/days/:dayIndex): reorder, remove, add a stop (from a place search), change visit length, move a stop to another day. Rerun Router (only legs that changed) and Timekeeper for affected days only. No LLM call.
Text change (POST /api/trips/:id/replan): a fast LLM turns text like "drop the museum, slower morning" into structured edits (remove, add-by-description, reorder, change pace, change time window, swap). Validate the edits, apply them, rerun only the affected stages and days. Adding places goes through Scout and Verifier.
Stops that did not change keep their ids and data.
Show a diff summary in the UI after a replan ("Removed X, moved Y to 14:30").
Undo the last change (keep the previous version in the document).
9. API
Method and path	Purpose
GET /api/health	status, which keys are configured, store type
POST /api/trips	plan a trip, SSE stream
GET /api/trips	recent saved trips (id, title, city, days, updatedAt)
GET /api/trips/:id	one trip
PATCH /api/trips/:id/days/:dayIndex	manual edits
POST /api/trips/:id/replan	text change
POST /api/trips/:id/undo	revert last change
DELETE /api/trips/:id	delete
GET /api/places/search?q=&tripId=	search places to add

All bodies validated with zod. Errors return { error: { code, message } } with sensible status codes. Rate limit planning and replanning per IP using DAILY_TRIP_LIMIT.

10. Frontend
Screens
Home: city input with suggestions, days, start/end time, pace, travel mode, party, budget, meals, diet, interests chips, must-see places (one per line), starting point. "Plan my trip" button. Saved trips list below.
Planning: the 3D city loads behind a panel of crew cards updating live from SSE. Pins drop onto the map as stops get verified. Routes draw as the router finishes.
Trip view (main screen):
Left sidebar: day tabs, ordered stop list with arrive times and leg times between stops, drag to reorder, remove button, add-stop search, replan text box, undo, day warnings.
Main area: 3D city with numbered pins (color per day) and route lines on the ground; current stop and its incoming leg highlighted, others dimmed.
Bottom stop card: photo with credit, name, kind, summary, why it fits (the Scout reason), arrive to depart, time there, next leg (mode, minutes, distance, "estimated" badge if so), "Directions in Google Maps" link, source links.
Controls: Back, Next, "Overview", day switcher. Keyboard: left/right arrows for Back/Next, Escape for overview.
Mobile: sidebar becomes a bottom sheet with the stop card on top.
3D and camera behaviour
Load tiles with 3d-tiles-renderer (Google auth plugin, reorientation so the trip center is the origin in metres with +Y up, compression and fade plugins, Draco decoder). Always show the tiles attribution overlay.
Keep plugin arguments memoized so they keep identity across renders.
Probe the tiles key once on load and show a clear message if it fails (missing key, API not enabled, referrer not allowed).
Convert stop lat/lon into the scene frame; raycast against loaded tiles to place pins on real surfaces, cache the height on the stop, and fall back to a default height until tiles load.
Stop view: camera sits offset from the stop at a comfortable distance and height (roughly 250 to 450 m away, pitched down 30 to 40 degrees), facing along the incoming leg's direction so the user sees where they came from and the stop ahead.
Next/Back flight: animate from the current view to the next stop's view over about 2 to 3.5 seconds (scale with distance, clamp), ease in-out, with a height arc in the middle so long hops rise above buildings. Option in settings: follow the actual route polyline instead of a direct arc.
Pressing Next during a flight skips to the end of the current flight, then starts the next.
Overview: frame all stops of the current day.
Light user orbit/zoom around the focused stop with limits so the camera cannot go underground or too far.
Respect prefers-reduced-motion by cutting instead of flying.
Preload tiles for the next stop while the user is looking at the current one if it is cheap to do (extra camera trick like the reference), otherwise skip.
Performance and quota guards
Never set tileset properties inside useFrame or any per-frame code.
Sensible errorTarget and cache limits; lower quality on mobile.
Count 3D sessions per device per day in localStorage and stop loading tiles past DAILY_TILE_SESSIONS with a friendly message.
Pause rendering when the tab is hidden.
Fixture mode (?fixture=<name>): load a saved trip from /fixtures with no planning calls, for UI work.
Look and feel

Clean and calm, one accent color, readable type, large tap targets. Loading and empty states everywhere. Clear errors when an upstream API is down, with retry.

11. Quality bar
Unit tests (Vitest) for: polyline decode, geo conversions, visiting order, timekeeper scheduling and audit, leg mode choice, replan edit application, zod schemas, the LLM wrapper retry logic (mocked).
No test calls a real paid API.
npm run typecheck, npm test, npm run build all pass.
README (your own words, about this app only): what it does, setup, which Google APIs to enable (Map Tiles API, Routes API), key restriction steps, setting quota caps in Google Cloud, fixture mode, deploy to Vercel, cost warnings, and data attributions (Google, OpenStreetMap contributors, Wikipedia/Wikimedia Commons).
12. Build phases

Stop after each phase and wait for me.

Phase 1: Skeleton Vite + React + TS app, server with /api/health, one npm run dev for both, .env.example, Vitest set up, README stub. Done when: app loads, health shows missing keys, tests run.

Phase 2: 3D city + hardcoded stops Google tiles for one city, 5 hardcoded stops as pins on real surfaces, stop card, Next/Back flights, overview, reduced-motion support, tile session guard. Done when: I can click Next/Back through 5 stops smoothly with attribution visible.

Phase 3: Routes Server Routes client with field masks, polyline decoding, route lines on the ground between the hardcoded stops, leg info in the card, estimated fallback. Done when: real street routes draw and leg times show.

Phase 4: Sidebar and trip view Day tabs, stop list, click to fly, highlight current, mobile bottom sheet, fixture mode with a sample 2-day trip. Done when: fixture trip is fully navigable on desktop and mobile widths.

Phase 5: Planning pipeline Surveyor, candidate pool, Scout, Verifier, food/lodging, day split, Router, Timekeeper, Critic, revision loop, caching, SSE, crew progress UI. Done when: I can plan a 2-day trip in a real city and it opens in the trip view. Tell me roughly how many LLM calls and tokens one plan used.

Phase 6: Storage Mongo store with in-memory fallback, saved trips list, open, delete. Done when: a trip survives a server restart with Mongo configured.

Phase 7: Editing and replanning Manual edits, text replan, diff summary, undo. Done when: "drop X, slower morning" works and only affected days are recomputed.

Phase 8: Polish and deploy Error states, rate limits, performance pass, Google Maps links, Vercel config, final README. Done when: it deploys to Vercel and works end to end.

Start with Phase 1. First, briefly confirm you understood the hard rules in section 0, then give your plan for Phase 1.