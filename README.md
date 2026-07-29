# Lookup — satellite tracking & astronomy

A Heavens-Above-style satellite tracker: visible pass predictions, an interactive 3D sky dome, and (coming soon) a planetarium star chart.

## Status

**Milestone 1 (this commit):** project scaffold, Celestrak TLE proxy/cache backend, satellite.js + astronomy-engine visible-pass prediction, and a pass-table UI for the ISS/space-stations group.

Not yet built: 3D sky dome, satellite trails, time scrubber, star chart, additional satellite groups (Starlink trains, visual-brightest) in the UI, and the 2D polar pass-detail chart.

## Structure

```
client/   Vite + React + TypeScript + Tailwind frontend
server/   Express + TypeScript backend (TLE cache + pass prediction)
```

npm workspaces tie them together from the repo root.

## Running locally

```
npm install
npm run dev:server   # http://localhost:3001
npm run dev:client   # http://localhost:5173 (proxies /api to the server)
```

## Backend

- `GET /api/tle/:group` — cached TLE fetch from Celestrak (`stations`, `visual`, `starlink`, `brightest`). Cache TTL is 4 hours; a stale cache is served if Celestrak is unreachable.
- `GET /api/passes?lat=&lon=&alt=&groups=&days=&minEl=` — computes visible passes (satellite sunlit + observer in darkness + above the elevation threshold) over the next N days for the given observer and satellite group(s).

Visibility/magnitude math lives in `server/src/passes.ts`:
- Darkness windows are found by scanning observer sun altitude (astronomy-engine) at coarse resolution, then satellite elevation is scanned at fine resolution inside those windows (satellite.js SGP4 propagation).
- Illumination uses a simple cylindrical Earth-shadow model.
- Apparent magnitude is an approximation based on range, phase angle, and a per-satellite standard magnitude (exact for ISS/Tiangong by name match, a reasonable default otherwise).

### Known environment constraint

This project fetches TLEs from `celestrak.org`. In network-restricted sandboxes that domain may be blocked by egress policy — check with `curl -sS "$HTTPS_PROXY/__agentproxy/status"` if `/api/tle/:group` returns a 502/403. The prediction code itself is verified independently of live network access (see `server/src/passes.ts`); it will work as soon as the process can reach `celestrak.org` directly (e.g. running locally, or in a production deployment without that restriction).

## Next steps

1. 3D sky dome (`@react-three/fiber` + `@react-three/drei`) with the ISS + trail
2. Time scrubber (now → +24h) driving recomputed positions
3. More satellite groups in the UI (Starlink, visual-brightest) + 2D polar pass-detail chart
4. Star/constellation/planet layer
