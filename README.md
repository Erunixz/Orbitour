# Orbitour

[![CI](https://github.com/Erunixz/Orbitour/actions/workflows/ci.yml/badge.svg)](https://github.com/Erunixz/Orbitour/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![React](https://img.shields.io/badge/React-19-61dafb)
![three.js](https://img.shields.io/badge/three.js-react--three--fiber-000000)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

**A trip planner where the 3D city is the interface.** Name a city and say what you like. A crew of code tools and two AI agents builds a day-by-day plan on real streets. You then fly through it one stop at a time over Google's photorealistic 3D tiles, and change it by hand or by typing what you want.

![Home page with the interactive globe](docs/home.png)

| Start from an example | Explore the plan stop by stop |
| --- | --- |
| ![Example trips](docs/examples.png) | ![Trip view with sidebar and stop card](docs/trip.png)(docs/trip2.png) |

## Highlights

- **AI that cannot make things up.** The two agents only choose and critique places. Every place comes from a verified list, and all times, distances and routes are computed in code. Every model reply is validated against a Zod schema before it is used.
- **Verified tourist places.** A place is a candidate only if OpenStreetMap tags it as worth visiting (museum, castle, viewpoint, monument…) *and* it has a Wikipedia article. Places are ranked by how many language editions of Wikipedia cover them (from Wikidata), so Paris starts with the Eiffel Tower and the Louvre, not a street or a historical event.
- **Preferences are rules, not hints.** Every stop must match a stated interest. A "free" budget excludes paid entry, and families get no long climbs. Code checks this after the AI picks, and a Critic agent sends bad picks back to be replaced.
- **A multi-stage planning pipeline, streamed live.** Ten crew members (8 code tools and 2 agents) run in a fixed order. Progress streams to the browser over Server-Sent Events, and pins appear on the map as places are verified.
- **Cinematic 3D camera.** Stop-to-stop flights swing around the target along the shorter arc and pull back while turning. The camera maths is pure and unit-tested. While a plan is being made, the camera circles the city from far out.
- **Built to stay cheap.** Every upstream answer is cached (memory or MongoDB). Routes requests send a field mask so only used fields are billed. There are per-visitor daily plan limits and per-device 3D-session limits, and rendering pauses in hidden tabs.
- **Degrades gracefully.** No keys at all? You get a sample trip on a grid map. No Routes key? Straight-line estimates, clearly marked. OpenStreetMap down? The place search falls back to Wikipedia, and the planning screen says so.
- **Tested offline.** 189 Vitest tests cover the pipeline, the verified-place rules, camera maths, editing, storage and the HTTP API, with fakes for every outside service. CI runs the type checks, build and tests on every push, with no keys.

## How planning works

```mermaid
flowchart LR
  A[Your request] --> S[Surveyor<br/>find city & must-sees]
  S --> L[Librarian<br/>verified places:<br/>OSM + Wikipedia + Wikidata]
  L --> SC{{Scout<br/>AI picks places}}
  SC --> V[Verifier<br/>only verified picks]
  V --> P[Planner<br/>group into days]
  P --> R[Router<br/>visit order & legs]
  R --> F[Food finder<br/>meals & lodging]
  F --> T[Timekeeper<br/>visit times]
  T --> W[Forecaster<br/>weather]
  W --> C{{Critic<br/>AI review}}
  C -- replace a stop --> SC
  C -- too rushed --> T
  C -- ok --> OUT[Trip saved<br/>& opened in 3D]
```

| Member | Kind | Job |
| --- | --- | --- |
| Surveyor | code | Finds the city, the starting point and each must-see place (Nominatim) |
| Librarian | code | Collects verified tourist places: tagged on OpenStreetMap, with a Wikipedia article, ranked by fame (Wikidata) |
| Scout | AI | Picks the places that fit your interests, party, budget and pace, only from the verified list |
| Verifier | code | Rejects any pick outside the verified list or the trip area, and adds a credited photo |
| Planner | code | Keeps the best stops (must-see always) and groups them into compact days |
| Router | code | Finds the visiting order and the travel between stops (Google Routes, or estimates) |
| Food finder | code | Adds lunch and dinner near the right stops, respecting your diet, and a place to stay (OpenStreetMap) |
| Timekeeper | code | Sets visit lengths and times, and drops the least important stop when a day runs long |
| Forecaster | code | Adds dates and weather notes for trips in the next 16 days (Open-Meteo) |
| Critic | AI | Reviews what numbers cannot judge and sends notes back to the Scout or the Timekeeper, at most twice |

## Tech stack

| Area | Tools |
| --- | --- |
| Web app | React 19, TypeScript, Vite |
| 3D | three.js, react-three-fiber, drei, 3d-tiles-renderer (Google Photorealistic 3D Tiles) |
| Server | Node 20, plain `node:http` with a small router, Server-Sent Events |
| AI | OpenAI API (structured JSON output, Zod-validated) |
| Data | OpenStreetMap (Nominatim, Overpass), Wikipedia, Wikidata, Wikimedia Commons, Open-Meteo, Google Routes |
| Storage | MongoDB Atlas, or in memory |
| Tests & CI | Vitest, GitHub Actions |

## Getting started

### 1. Run it with no keys (2 minutes)

Requirements: Node 20.12 or newer, and npm.

```bash
git clone https://github.com/Erunixz/Orbitour.git
cd Orbitour
npm install
cp .env.example .env
npm run dev
```

- Open **http://localhost:5173** for the home page and globe.
- Open **http://localhost:5173/?fixture=paris-2day** for a sample two-day Paris trip. It needs no keys and shows on a plain grid map.
- Open **http://localhost:5173/status** to see which settings are set.

`npm run dev` starts the web app on port 5173 and the API server on port 8787 (the web app forwards `/api` to it).

### 2. Add keys for the full experience

| Setting | Needed for | Without it |
| --- | --- | --- |
| `OPENAI_API_KEY` + `LLM_MODEL_SCOUT`, `LLM_MODEL_CRITIC` | Planning new trips | Planning stops at the Scout with a clear message |
| `LLM_MODEL_FAST` | Typed changes ("drop the museum") | Manual edits still work |
| `VITE_GOOGLE_TILES_KEY` | The photorealistic 3D city | A plain grid with the same pins and routes |
| `GOOGLE_ROUTES_KEY` | Real street routes and transit | Straight-line estimates, marked "estimated" |
| `MONGODB_URI`, `MONGODB_DB` | Keeping trips after a restart | Trips live in server memory |
| `CONTACT_EMAIL` | A polite User-Agent for OpenStreetMap and Wikimedia | Requests go out without a contact address |
| `DAILY_TRIP_LIMIT` | Plans and typed changes per visitor per day (default 20, `0` = off) | |
| `DAILY_TILE_SESSIONS` | 3D map loads per device per day (default 50) | |

All settings live in `.env`, which git ignores. Only the Tiles key has the `VITE_` prefix, because it is built into the web page (and restricted to your site). Every other key stays on the server. Step-by-step key setup is in [Setting up the keys](#setting-up-the-keys) below.

After changing `.env`, restart `npm run dev`.

## Using Orbitour

### Plan a trip

1. On the home page, drag the globe or pick an example card to fill in the form, or type a city yourself.
2. Choose days, hours, pace, how you get around, who is going, budget, meals, diet and interests. Optionally add must-see places, a starting point (your hotel) and a start date (for dates and weather).
3. Press **Plan my trip**. The city circles in 3D while each crew member lights up with what it is doing. A plan usually takes under a minute.

### Explore it

- **Next** and **Back** (or the arrow keys) fly between stops. **Overview** (or Escape) frames the whole day. Click a pin to fly to it, drag to orbit, scroll to zoom.
- Each stop card shows the photo, times, a summary, why it fits you, and the next leg, with links to Google Maps directions and Wikipedia.
- **Fly along routes** makes the camera follow the streets instead of arcing between stops.
- **Open this day in Google Maps** gives the whole day as one route.
- The address keeps your place (`#day=2&stop=3`), so a reload or a shared link opens the same stop. On a phone the stop list is a sheet: tap **Stops**.

### Change it

- **Edit stops:** reorder (buttons, or drag on desktop), change time spent, move to another day, or remove.
- **Add a place:** search near the trip. It goes where it adds the least walking.
- **Describe a change:** type something like "drop the museum, slower morning". A fast model turns it into edits that code checks before applying.
- Only changed days are re-timed. A summary lists what changed, with **Undo**.

Every plan is saved, and the home page lists recent trips to reopen or delete.

## Setting up the keys

<details>
<summary><b>Google Map Tiles (3D city)</b></summary>

1. At https://console.cloud.google.com create a project and a billing account.
2. Enable the **Map Tiles API**: https://console.cloud.google.com/apis/library/tile.googleapis.com
3. Create an API key at https://console.cloud.google.com/apis/credentials. Restrict it to **Websites** `http://localhost:5173/*` (add your real site later) and to the **Map Tiles API** only.
4. Put it in `.env` as `VITE_GOOGLE_TILES_KEY` and restart `npm run dev`.

Always open the app at `http://localhost:5173`. Other addresses, like `127.0.0.1` or another port, are blocked by the key restriction. The dev server refuses to start on another port for this reason. If tiles fail, the map says why: missing key, API not enabled, site not allowed, and so on.
</details>

<details>
<summary><b>Google Routes (optional)</b></summary>

1. Enable the **Routes API**: https://console.cloud.google.com/apis/library/routes.googleapis.com
2. Create a second key with no website restriction (only the server uses it) and API restriction **Routes API** only.
3. Put it in `.env` as `GOOGLE_ROUTES_KEY`.
</details>

<details>
<summary><b>OpenAI</b></summary>

1. Add prepaid credit at https://platform.openai.com/settings/organization/billing.
2. Create a key at https://platform.openai.com/api-keys and put it in `OPENAI_API_KEY`.
3. Pick models your account can use (https://platform.openai.com/docs/models) for `LLM_MODEL_SCOUT`, `LLM_MODEL_CRITIC` and `LLM_MODEL_FAST`. A small reasoning model works well for the first two, and a small fast model for the third.
</details>

<details>
<summary><b>MongoDB Atlas (keep trips)</b></summary>

1. Create a free **M0** cluster at https://cloud.mongodb.com.
2. **Database Access:** add a user with a password (letters and numbers are safest).
3. **Network Access:** add your IP address.
4. **Connect, Drivers:** copy the string (`mongodb+srv://USER:PASSWORD@cluster.xxxxx.mongodb.net/...`), fill in the user and password without `< >`, and put it in `MONGODB_URI`.

Upstream answers are cached in the database too, and MongoDB expires old ones on its own.
</details>

### Costs

| Service | Cost |
| --- | --- |
| Wikipedia, Wikidata, OpenStreetMap, Open-Meteo | Free, no account |
| MongoDB Atlas M0 | Free |
| Google Map Tiles and Routes | Free monthly allowance per API (billing account required). Light personal use normally stays inside it |
| OpenAI | Pay per use. A plan is usually 2 calls (up to 6 with revisions), about a cent or less with small models |

Set an OpenAI monthly budget (https://platform.openai.com/settings/organization/limits) and a Google budget alert (https://console.cloud.google.com/billing/budgets) before you start.

## Development

| Script | What it does |
| --- | --- |
| `npm run dev` | Web app and API server with reload |
| `npm run typecheck` | Type checks the app, server and tests |
| `npm test` | Runs the tests (no network, no paid APIs) |
| `npm run build` | Type checks, builds the web app and the server |
| `npm start` | Runs the built server |

```
src/
  plan-ui/   home page, globe, example trips, planning screen
  map/       3D tiles, pins, routes, camera (loaded only when a map is shown)
  trip/      trip view, sidebar, stop card, editing
  lib/       shared types, schemas, geo, polyline, API client
server/
  pipeline/  the planning crew, preference rules, editing and replanning, prompts
  upstream/  clients for Google Routes, Nominatim, Overpass, Wikipedia, Wikidata, Open-Meteo
  llm/       the one wrapper for all AI calls
  store/     trips in MongoDB or memory
  routes/    HTTP handlers
api/         Vercel entry (one function for all /api routes)
fixtures/    sample trips
tests/       Vitest tests with fakes for every outside service
```

## Design decisions

- **Agents choose, code computes.** Language models are good at taste ("does this suit a family who loves art?") and bad at arithmetic and facts. So the agents only select from a verified list and critique the result. Everything measurable (distances, visiting order, times, meal slots) is deterministic code, which also makes it testable.
- **Verification by two independent sources.** OpenStreetMap says a place is a tourist site. Wikipedia and Wikidata say it is notable and give its summary, photo and fame. Needing both removes streets, companies, events and people that plain geosearch returns.
- **The critic routes its notes.** Each complaint names the crew member that must fix it: a stop to replace goes to the Scout, a rushed day to the Timekeeper. There are at most two rounds, and leftover notes become visible warnings instead of silent retries.
- **Cost is a feature.** Caching, field masks, rate gates for free public APIs (Nominatim's 1 request per second, Wikimedia etiquette), daily limits, and a 3D-session budget per device are built in from the start.
- **The 3D code is lazy-loaded.** three.js and the tiles renderer load only when a map or the globe is on screen, so the form appears immediately.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| "This site is not allowed to use the key" | Open the app at `http://localhost:5173` exactly. If Vite says the port is in use, stop the old servers (below) |
| "Port 5173 is in use" | PowerShell: `Get-NetTCPConnection -LocalPort 5173,8787 -State Listen \| ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }` |
| "Your OpenAI account has no credit left" | Add API credit on the OpenAI billing page |
| "OpenAI does not know that model (404)" | Check the `LLM_MODEL_*` names |
| /status says the database is not reachable | Check `MONGODB_URI` has the user and password, your IP is allowed in Atlas, and restart `npm run dev` |
| The map shows a grid | No Tiles key, or today's 3D sessions are used up. A message on the map says which |

## Roadmap

- Deploy as a single Vercel function (`api/index.ts` is ready; needs `vercel.json`, a longer timeout for planning, and an unbuffered event stream).
- Replace the text "Google" credit on the map with the official logo, as the Map Tiles policies require for public sites.
- Opening hours from OpenStreetMap in the Timekeeper.

## Credits

- 3D map tiles and routes: Google.
- Places: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), via Nominatim and Overpass.
- Summaries: Wikipedia. Fame ranking: Wikidata. Photos: Wikimedia Commons, credited on each photo.
- Weather: Open-Meteo. Globe textures: NASA Blue Marble and Earth at night (via [three-globe](https://github.com/vasturiano/three-globe)), clouds from [webgl-earth](https://github.com/turban/webgl-earth).

## License

[MIT](LICENSE) © 2026 Erfan Zamani
