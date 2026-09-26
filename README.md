# Orbitour

A trip planner where the 3D city is the interface. Name a city, describe the trip, and get a day-by-day plan on real streets. Then move through it one stop at a time on photorealistic 3D tiles.

This README is a stub. It will grow as features land.

## Requirements

- Node 20.12 or newer (Vite 7 would need 20.19+, so this project uses Vite 6 for now)
- npm

## Setup

```bash
npm install
cp .env.example .env   # then fill in the keys you have
npm run dev
```

`npm run dev` starts two things:

- the web app at http://localhost:5173
- the API server at http://localhost:8787 (the web app proxies `/api` to it)

The server starts without any keys. Open http://localhost:5173/status, or `http://localhost:8787/api/health`, to see which settings are missing.

## 3D city (Google Photorealistic 3D Tiles)

1. In Google Cloud Console, enable the **Map Tiles API** and set up billing.
2. Create an API key. Under key restrictions choose **HTTP referrers** and add `http://localhost:5173/*` (and your deployed site later). Under API restrictions allow only the Map Tiles API.
3. Put the key in `.env` as `VITE_GOOGLE_TILES_KEY` and restart `npm run dev`.
4. Set a daily quota cap for the Map Tiles API in Google Cloud Console (APIs and Services, Map Tiles API, Quotas). This is the real cost guard.

Without a key the map shows a plain grid with the pins, so you can still try the navigation.

Cost guards in the app:

- Each page load that shows the 3D city counts as one session. After `DAILY_TILE_SESSIONS` sessions on a device in a day, tiles stop loading until the next day. The count lives in the browser's localStorage.
- Tile settings are applied once and never changed per frame. Changing tileset settings every frame makes the renderer reload the city again and again.
- Rendering pauses while the tab is hidden, and phones get a lighter quality preset.

## Routes (Google Routes API)

1. Enable the **Routes API** in the same or another Google Cloud project.
2. Create a separate key. Under API restrictions allow only the Routes API. This key stays on the server, so do not add referrer restrictions and never prefix it with `VITE_`.
3. Put it in `.env` as `GOOGLE_ROUTES_KEY` and restart `npm run dev`.
4. Set a daily quota cap for the Routes API too.

Every Routes request sends a field mask, so Google returns (and bills) only the fields we use. Answers are cached for a day. Rate limits (429) and server errors are retried with backoff, up to 3 tries.

Without a key, or when Google fails or finds no route, each leg becomes a straight-line estimate: the distance times a detour factor at a typical speed for the mode. These legs are dashed on the map and marked "Estimated" in the card.

When the trip's travel mode is "auto", each leg picks walking, transit, or driving from its distance and the budget.

## Using the trip view

- The sidebar lists each day's stops with arrive and leave times and the travel between them. Pick a day tab, then a stop, to fly there. On a phone the list sits in a sheet at the bottom: tap **Stops** to open it.
- **Next** and **Back** (or the right and left arrow keys) fly from stop to stop. After the last stop of a day, Next goes on to the next day.
- **Overview** (or Escape) frames the whole day.
- Click a pin to fly straight to it. Drag to orbit and scroll to zoom around the current stop.
- With "reduce motion" turned on in your system settings, the camera cuts instead of flying.
- Turn on **Fly along routes** to follow the street route between neighbouring stops instead of a direct arc.
- The address keeps your place, for example `#day=2&stop=3`, so a reload or a shared link opens the same stop.

## Fixture mode

Saved trips in `fixtures/` open with no planning calls, which is handy for UI work: `http://localhost:5173/?fixture=paris-2day`. Until planning is built, the app opens `paris-2day` by default.

The sample trip uses straight-line travel estimates (marked "estimated"). Its summaries come from Wikipedia and its photos from Wikimedia Commons, with the author and license shown on each photo.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Web app and API server with reload |
| `npm run typecheck` | Type checks app, server, and tests |
| `npm test` | Runs unit tests (no paid APIs are called) |
| `npm run build` | Type checks, builds the web app and the server |
| `npm start` | Runs the built server |

## Project layout

```
src/        React app (map, trip, plan-ui, lib)
server/     HTTP server, routes, planning pipeline
api/        Vercel entry that forwards to the server
fixtures/   Saved sample trips for offline UI work
tests/      Vitest tests
```
