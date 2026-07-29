# Lookup — satellite tracking & astronomy

A Heavens-Above-style satellite tracker: visible pass predictions, an interactive 3D sky dome, and (coming soon) a planetarium star chart.

## Status

**Milestone 1:** project scaffold, Celestrak TLE proxy/cache backend, satellite.js + astronomy-engine visible-pass prediction, and a pass-table UI for the ISS/space-stations group.

**Milestone 2 (this commit):** interactive 3D sky dome with procedural satellite models, fading orbital trails, click/hover detail labels, camera aiming, and a 24-hour time scrubber with playback.

Not yet built: star chart / constellation layer, additional satellite groups (Starlink trains, visual-brightest) in the UI, the 2D polar pass-detail chart, cloud-cover flagging via Open-Meteo, and NASA `.glb` spacecraft models.

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

- `GET /api/tle/:group` — cached TLE fetch from Celestrak (`stations`, `visual`, `starlink`, `brightest`). Cache TTL is 4 hours.
- `GET /api/passes?lat=&lon=&alt=&groups=&days=&minEl=` — computes visible passes (satellite sunlit + observer in darkness + above the elevation threshold) over the next N days.

Both responses carry a `source` field describing element provenance, which the UI surfaces:

| `source`  | Meaning |
| --------- | ------- |
| `live`    | Fresh from Celestrak, or a still-fresh cache entry |
| `cache`   | Celestrak unreachable; serving a cache entry past its TTL |
| `fixture` | Celestrak unreachable and nothing cached; bundled dev-only elements. **Not valid for real predictions** — the UI shows a warning banner |

The fixture fallback is disabled when `NODE_ENV=production`; override either way with `ALLOW_TLE_FIXTURE=1` / `=0`.

### Visibility and brightness model

Lives in `server/src/passes.ts`:

- Darkness windows are found by scanning observer sun altitude (astronomy-engine) coarsely, then satellite elevation is scanned finely inside those windows (satellite.js SGP4).
- Illumination uses satellite.js's `shadowFraction`, which models the penumbra rather than a hard cylindrical shadow, so a satellite fading into eclipse mid-pass is captured.
- Apparent magnitude approximates range, phase angle, and a per-satellite standard magnitude, then dims by the eclipsed fraction of the Sun's disc.
- Sun position for satellite illumination comes from satellite.js (same TEME frame as the SGP4 output, so the two stay self-consistent); astronomy-engine handles observer twilight, where its topocentric horizon model with refraction is the better tool.

## 3D sky dome

- **Camera rig.** The camera orbits at a negligible radius (0.02) around the centre of a radius-100 dome, so the viewer stands at the observer's own position. Keeping that offset tiny against the dome radius means objects placed by azimuth/elevation render at correct angles with no parallax error. Because the orbit distance is pinned, zoom changes field of view instead of dollying — wheel on desktop, pinch on touch.
- **Trails** are re-derived analytically by propagating backwards from the display time rather than accumulating a rolling buffer of observed samples. That keeps them stateless and therefore correct while scrubbing or playing back, not only while time advances in real time.
- **Labels** use drei's `Html`, wrapped in a `FrontFacingHtml` guard. A perspective projection maps points behind the camera back onto the viewport inverted, so without the guard the southern cardinal labels show up while you're facing north.
- **Aiming.** The view swings to whatever is highest above the horizon when the sky goes from empty to occupied, and to any satellite you select; grabbing the sky cancels the animation so you never fight the camera.
- Satellite models are procedural low-poly (an ISS-shaped truss with four array pairs, and a generic box-plus-wings bus). NASA's `.glb` models are a later addition.

## Time scrubber

`useTimeControl` decouples display time from wall-clock time. In live mode an anchor follows the real clock each second; scrubbing or playing freezes the anchor and moves an offset over a 24-hour range. Playback advances at 1×/60×/300×/1800×, throttled to 25 Hz so propagation isn't recomputed 60 times a second.

## Notes on dependencies

- **satellite.js v7** is used in both workspaces. Its entry point re-exports an optional WASM backend whose pthreads build uses top-level await and `node:worker_threads`; a small Vite plugin (`stubSatelliteWasm`) keeps that barrel out of the browser bundle, since only the pure-JS SGP4 API is used.
- **astronomy-engine** ships a CJS build exposing its API directly and an ESM build nesting the same API under `default`. Which one a loader picks varies, so `server/src/passes.ts` normalises both shapes.

### Known environment constraint

`celestrak.org` is blocked by egress policy in some sandboxes (the proxy answers `403` to `CONNECT`). When that happens the server logs a warning and falls back to the bundled fixture, and the UI shows the amber banner. Everything works against live data as soon as the process can reach `celestrak.org`.

## Next steps

1. Star / constellation / planet layer as a toggleable dome layer
2. 2D polar sky-track chart for a selected pass (print/fallback view)
3. More satellite groups in the UI (Starlink trains, visual-brightest) with filtering
4. Optional Open-Meteo cloud-cover flagging
