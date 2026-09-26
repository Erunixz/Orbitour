# Orbitour

A trip planner where the 3D city is the interface. Name a city and describe the trip, and a crew of code tools and two AI agents builds a day-by-day plan on real streets. Then move through it one stop at a time on photorealistic 3D tiles, and change it by hand or by typing what you want.

- Numbered pins on real rooftops, routes along the streets, one colour per day.
- Next and Back fly the camera from stop to stop. A card shows the photo, times, why it fits, and the next leg.
- Every place comes from a real source (Wikipedia or OpenStreetMap). All times and routes are worked out in code, never by the AI.
- Edit stops, add places, type changes like "drop the museum, slower morning", and undo.
- Trips are saved and can be reopened.

## Quick start

Requirements: Node 20.12 or newer, and npm.

```bash
npm install
cp .env.example .env   # then fill in the keys you have
npm run dev
```

This starts the web app at http://localhost:5173 and the API server at http://localhost:8787 (the web app forwards `/api` to it). Open http://localhost:5173/status to see which settings are set and whether the database is reachable.

The app runs with no keys at all: you can open the sample trip and try the map on a plain grid. To plan trips you need an OpenAI key.

On Windows, stopping `npm run dev` with Ctrl+C can leave node running. If the next start says a port is in use, run in PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 5173,8787 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

## Settings

All settings live in `.env`, which git ignores. Never put keys anywhere else.

| Setting | Needed for | Without it |
| --- | --- | --- |
| `OPENAI_API_KEY` | Planning and typed changes | Planning stops at the Scout with a clear message |
| `LLM_MODEL_SCOUT`, `LLM_MODEL_CRITIC` | The two planning agents (can be the same model) | Same as above; without the Critic model, plans skip the review |
| `LLM_MODEL_FAST` | Typed changes ("drop the museum") | Manual edits still work |
| `VITE_GOOGLE_TILES_KEY` | The photorealistic 3D city | A plain grid with the same pins and routes |
| `GOOGLE_ROUTES_KEY` | Real street routes and transit | Straight-line estimates, marked "estimated" |
| `MONGODB_URI`, `MONGODB_DB` | Keeping trips after a restart | Trips live in server memory |
| `CONTACT_EMAIL` | A polite User-Agent for Nominatim and Wikipedia | Requests go out without a contact address |
| `DAILY_TRIP_LIMIT` | Plans and typed changes per visitor per day (default 20, `0` = off) | |
| `DAILY_TILE_SESSIONS` | 3D map loads per device per day (default 50) | |

`VITE_` settings are built into the web page, so only the Tiles key (which is restricted to your site) has that prefix. Every other key stays on the server.

## Costs

| Service | Cost |
| --- | --- |
| Wikipedia, OpenStreetMap (Nominatim, Overpass), Open-Meteo | Free, no account |
| MongoDB Atlas M0 cluster | Free |
| Google Map Tiles and Routes | A free monthly allowance per API; a billing account with a card is required. Light personal use normally stays inside it. See https://mapsplatform.google.com/pricing |
| OpenAI | Pay per use from prepaid credit. A plan is usually 2 calls (up to 6 with Critic revisions); with a small model that is around a cent or less. A typed change is 1 small call |

Set caps before you start:

- **OpenAI:** a monthly budget at https://platform.openai.com/settings/organization/limits, and turn off auto recharge.
- **Google:** a budget alert (or spend cap) at https://console.cloud.google.com/billing/budgets, and lower daily quotas for each API if your account allows it.

The app guards cost too. It caches every upstream answer, and routes are cached for a day. It caps 3D sessions per device and plans per visitor. It never changes tile settings inside the render loop, pauses rendering in hidden tabs, and uses lighter quality on phones. The tests never call a paid API.

## Setting up the keys

### Google Map Tiles (3D city)

1. At https://console.cloud.google.com create a project and a billing account.
2. Enable the **Map Tiles API**: https://console.cloud.google.com/apis/library/tile.googleapis.com
3. Create an API key at https://console.cloud.google.com/apis/credentials. Restrict it to **Websites** `http://localhost:5173/*` (add your real site later) and to the **Map Tiles API** only.
4. Put it in `.env` as `VITE_GOOGLE_TILES_KEY` and restart `npm run dev`.

If the tiles fail, the map shows why: missing key, API not enabled, site not allowed, and so on.

### Google Routes (optional)

1. Enable the **Routes API**: https://console.cloud.google.com/apis/library/routes.googleapis.com
2. Create a second key. No website restriction (it is only used by the server), API restriction **Routes API** only.
3. Put it in `.env` as `GOOGLE_ROUTES_KEY`.

Every Routes request sends a field mask, so Google returns and bills only the fields used. With a key, each day's visiting order also uses a route matrix. Rate limits and server errors are retried with backoff. When routing fails, a leg falls back to a straight-line estimate at a typical speed.

### OpenAI

1. Add prepaid credit at https://platform.openai.com/settings/organization/billing (no plan or subscription needed).
2. Create a key at https://platform.openai.com/api-keys and put it in `OPENAI_API_KEY`.
3. Pick models your account can use (https://platform.openai.com/docs/models) for `LLM_MODEL_SCOUT`, `LLM_MODEL_CRITIC` and `LLM_MODEL_FAST`. A small reasoning model works well for the first two, and a small fast model for the third.

### MongoDB Atlas (keep trips)

1. Create a free **M0** cluster at https://cloud.mongodb.com (you can skip the sample dataset).
2. **Database Access:** add a database user with a password (letters and numbers are safest).
3. **Network Access:** add your IP address.
4. **Connect, Drivers:** copy the string. It has the form `mongodb+srv://USER:PASSWORD@cluster.xxxxx.mongodb.net/?appName=...`. Fill in both the user and the password, without `< >`, and put it in `MONGODB_URI`.

With a database, upstream answers are cached there as well, and MongoDB deletes old ones on its own.

## Planning a trip

On the home page, fill in the city, days, hours, pace, how you get around, who is going, budget, meals, diet, interests, must-see places and an optional starting point and start date. Then press **Plan my trip**. The 3D city loads behind the crew, and each crew member lights up as it works:

| Member | Kind | Job |
| --- | --- | --- |
| Surveyor | code | Finds the city, the starting point and each must-see place (Nominatim) |
| Librarian | code | Collects notable places nearby from Wikipedia and drops streets, districts, stations, people and events |
| Scout | AI | Picks the places that fit, only from that list or your must-see places |
| Verifier | code | Keeps a pick only if it is a real article inside the trip area, and adds a credited photo |
| Planner | code | Keeps the best stops (must-see always) and groups them into compact days |
| Router | code | Finds the best visiting order and the travel between stops |
| Food finder | code | Adds lunch and dinner near the right stops, and a place to stay (OpenStreetMap) |
| Timekeeper | code | Sets visit lengths and times, and drops the least important stop when a day runs long |
| Forecaster | code | Adds dates and weather notes when you give a start date within 16 days (Open-Meteo) |
| Critic | AI | Reviews the plan for what numbers cannot judge and sends notes to the Scout or the Timekeeper |

The AI agents never do math, write times or invent places. Their replies are checked in code and retried once with more room if cut off. The Critic's notes go back to the member it names, at most twice, and anything left over becomes a note on that day. Each day starts at your starting point ("S") when you give one. The server logs each plan's AI calls and token counts, never keys or your request.

The city field suggests from a built-in list, because Nominatim's usage policy does not allow search-as-you-type. The city is looked up once, when planning starts.

## Using the trip view

- The sidebar lists each day's stops with times and the travel between them. On a phone it is a sheet at the bottom: tap **Stops**.
- **Next** and **Back** (or the arrow keys) fly between stops. **Overview** (or Escape) frames the whole day. Click a pin to fly to it, drag to orbit, scroll to zoom.
- **Fly along routes** makes the camera follow the street route instead of a direct arc. With "reduce motion" on, the camera cuts instead of flying.
- Each card links to directions in Google Maps. **Open this day in Google Maps** gives the whole day as one route.
- The address keeps your place (`#day=2&stop=3`), so a reload or a shared link opens the same stop.

## Changing a trip

Saved trips can be changed from the sidebar or the Stops sheet. Sample trips are read-only.

- **Edit stops** shows controls under each place: earlier and later (or drag the row on desktop), time spent there, move to another day, remove.
- **Add a place** searches near the trip when you press Search, and puts the place where it adds the least walking.
- **Describe a change** takes text like "drop the museum, slower morning". The fast model turns it into edits that code checks before applying. New places go through the Scout and the Verifier.

Only the changed days are re-timed and only new legs routed. Your edits are kept even when a day runs long: you get a warning instead. After each change a box lists what changed, with **Undo** for one step back.

## Saved trips

Every plan is saved whole, and the home page lists recent trips to open or delete. If the database is unreachable, the list shows an error with a retry, and a new plan is still shown with a note that it was not saved.

## Sample trips (fixture mode)

Trips in `fixtures/` open with no planning calls: http://localhost:5173/?fixture=paris-2day. The home page links to it. The sample uses straight-line travel estimates, Wikipedia summaries and credited Wikimedia Commons photos.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| "Your OpenAI account has no credit left" | Add credit on the OpenAI billing page (API credit, not ChatGPT Plus) |
| "OpenAI does not know that model (404)" | Check the `LLM_MODEL_*` names on the OpenAI models page |
| /status says the database is not reachable | Check `MONGODB_URI` has both user and password, and that your IP is allowed in Atlas |
| The map shows a grid | No Tiles key, or today's 3D sessions are used up. A message on the map says which |
| "This device has used its ... plans" | Wait for tomorrow (UTC), or change `DAILY_TRIP_LIMIT` |
| A port is in use | Stop the leftover node processes (see Quick start) |

## Deploying

The project is ready for one Vercel function (`api/index.ts` sends every `/api` request to the same server code), but it has not been deployed or tested there, and there is no `vercel.json` yet. Before a public deploy:

- add the site's address to the Tiles key's allowed websites;
- set all settings in the hosting provider, not in files;
- set a longer function timeout for planning, and check that the progress stream is not buffered;
- replace the text "Google" credit on the map with the official Google Maps logo, as the Map Tiles policies require;
- keep `DAILY_TRIP_LIMIT` on, and remove your keys when you no longer need the site.

## Data credits

- Map tiles and routes: Google. The map shows Google's data credits for the tiles on screen.
- Places: © OpenStreetMap contributors (https://www.openstreetmap.org/copyright), via Nominatim and Overpass.
- Summaries: Wikipedia. Photos: Wikimedia Commons, with the author and license on each photo.
- Weather: Open-Meteo.

The trip view repeats these credits under the stop list.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Web app and API server with reload |
| `npm run typecheck` | Type checks the app, server and tests |
| `npm test` | Runs the tests (no paid APIs are called) |
| `npm run build` | Type checks, builds the web app and the server |
| `npm start` | Runs the built server |

## Project layout

```
src/
  map/       3D tiles, pins, routes, camera (loaded only when a map is shown)
  trip/      trip view, sidebar, stop card, editing
  plan-ui/   home form, saved trips, planning crew
  lib/       shared types, schemas, geo, polyline, API client
server/
  pipeline/  the planning crew, editing and replanning, prompts
  upstream/  clients for outside services (Google Routes, Nominatim, Wikipedia, Overpass, Open-Meteo)
  llm/       the one wrapper for all AI calls
  store/     trips in MongoDB or memory
  routes/    HTTP handlers
api/         Vercel entry
fixtures/    sample trips
tests/       Vitest tests with mocked services
```
