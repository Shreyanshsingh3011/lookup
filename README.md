# Lookup — satellite tracking & astronomy

A Heavens-Above-style satellite tracker: visible pass predictions, an interactive 3D sky dome, and (coming soon) a planetarium star chart.

## Status

**Milestone 1:** project scaffold, Celestrak TLE proxy/cache backend, satellite.js + astronomy-engine visible-pass prediction, and a pass-table UI for the ISS/space-stations group.

**Milestone 2:** interactive 3D sky dome with procedural satellite models, fading orbital trails, click/hover detail labels, camera aiming, and a 24-hour time scrubber with playback.

**Milestone 3:** planetarium layers — 5,044 stars to magnitude 6 with colour-index tinting, 88 constellation figures, named bright stars, and the naked-eye planets plus Sun and Moon, all toggleable.

**Milestone 4 (this commit):** click a pass for its 2D polar sky-track chart, with a print view, and a "Show in 3D" jump that drives the dome to that pass.

Not yet built: additional satellite groups (Starlink trains, visual-brightest) in the UI, cloud-cover flagging via Open-Meteo, and NASA `.glb` spacecraft models.

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
- A pass reports *why* it ended — `set`, `shadow`, or `daylight` — taken from the first sample that failed the visibility test. It has to come from that terminating sample rather than the last visible one: every sample inside a pass is illuminated and above the horizon by construction, so inspecting the last visible sample could only ever report `set`.
- Sun position for satellite illumination comes from satellite.js (same TEME frame as the SGP4 output, so the two stay self-consistent); astronomy-engine handles observer twilight, where its topocentric horizon model with refraction is the better tool.

## 3D sky dome

- **Camera rig.** The camera orbits at a negligible radius (0.02) around the centre of a radius-100 dome, so the viewer stands at the observer's own position. Keeping that offset tiny against the dome radius means objects placed by azimuth/elevation render at correct angles with no parallax error. Because the orbit distance is pinned, zoom changes field of view instead of dollying — wheel on desktop, pinch on touch.
- **Trails** are re-derived analytically by propagating backwards from the display time rather than accumulating a rolling buffer of observed samples. That keeps them stateless and therefore correct while scrubbing or playing back, not only while time advances in real time.
- **Labels** use drei's `Html`, wrapped in a `FrontFacingHtml` guard. A perspective projection maps points behind the camera back onto the viewport inverted, so without the guard the southern cardinal labels show up while you're facing north.
- **Aiming.** The view swings to whatever is highest above the horizon when the sky goes from empty to occupied, and to any satellite you select; grabbing the sky cancels the animation so you never fight the camera.
- Satellite models are procedural low-poly (an ISS-shaped truss with four array pairs, and a generic box-plus-wings bus). NASA's `.glb` models are a later addition.

## Planetarium layers

Four independently toggleable layers: satellites, stars, constellations, planets.

### Star field

The catalogue is generated at build time from d3-celestial's data files by
`scripts/build-sky-catalog.mjs` (`npm run build:catalog`) into a compact
`client/src/data/skyCatalog.json` — 5,044 stars to magnitude 6, 88 constellation
figures, and proper names for 65 bright stars, in flat parallel arrays. Only the
generated subset ships; d3-celestial itself stays a devDependency. See
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for attribution.

All stars render as a single `Points` draw call, and all constellation figures as
a single `LineSegments` call. Star size derives from magnitude and colour from
B−V index, so Betelgeuse reads orange and Rigel blue-white.

**The key trick** is in `lib/celestial.ts`: rather than converting every star to
horizontal coordinates each frame, the whole celestial sphere is one rigid
rotation away from scene coordinates. The geometry is built once from fixed
RA/Dec, and only a single 3×3 matrix changes as time advances or the observer
moves — O(1) per frame instead of O(5044). The derivation is documented in
`equatorialToSceneMatrix`, and it was cross-checked against astronomy-engine's
independent `Horizon()` implementation: agreement within 0.002° across 180
star/site/time combinations spanning the equator, the arctic, and both
hemispheres.

Coordinates are J2000 and are not precessed to the epoch of date, which is a
sub-arcminute effect at present — smaller than a rendered star glyph.
Atmospheric refraction is deliberately not applied, matching how satellite
elevations are computed elsewhere in the app.

### Planets

Sun, Moon, Mercury, Venus, Mars, Jupiter and Saturn come from astronomy-engine
per frame (seven bodies is far too cheap to bother optimising), with apparent
magnitude and, for the Moon, illuminated fraction. Uranus and Neptune are
omitted: at magnitude 5.7+ they add clutter without being what anyone scanning
the sky is looking for.

## Pass detail and sky-track chart

Clicking a row in the pass table opens a detail panel with a 2D polar chart:
zenith at the centre, horizon at the rim, radius linear in elevation.

Orientation is the **looking-up** convention — north at the top, east to the
**left** — so the chart matches the sky when held overhead with the top pointing
north. (A map of the ground would mirror it; all eight compass points are
labelled, so it is unambiguous either way.)

The track is computed in the browser from the TLEs already fetched for the dome,
so there is no extra round trip. It draws the *entire* above-horizon arc rather
than only the reported visible window: the bright segment is when the satellite
is sunlit and the observer is dark, and the dashed remainder shows where it is
above the horizon but invisible. That is what makes a satellite disappearing
mid-sky legible.

`@media print` restates the palette as black-on-white and hides the header, dome
and table, so the browser's print command yields a single clean sheet — an
astronomy tool's dark theme wastes ink and reads poorly on paper.

**Show in 3D** re-anchors the timeline to the selected pass and scrolls to the
dome. Passes are predicted 10 days out, well beyond the scrubber's 24-hour
range, so this re-anchors the timeline's zero point rather than offsetting from
the present instant — at which point the scrubber shows the date instead of
"+2h from now", which would be a lie.

## Time scrubber

`useTimeControl` decouples display time from wall-clock time. In live mode an anchor follows the real clock each second; scrubbing or playing freezes the anchor and moves an offset over a 24-hour range. Playback advances at 1×/60×/300×/1800×, throttled to 25 Hz so propagation isn't recomputed 60 times a second.

## Notes on dependencies

- **satellite.js v7** is used in both workspaces. Its entry point re-exports an optional WASM backend whose pthreads build uses top-level await and `node:worker_threads`; a small Vite plugin (`stubSatelliteWasm`) keeps that barrel out of the browser bundle, since only the pure-JS SGP4 API is used.
- **astronomy-engine** ships a CJS build exposing its API directly and an ESM build nesting the same API under `default`. Which one a loader picks varies, so `server/src/passes.ts` and `client/src/lib/astronomy.ts` normalise both shapes.
- The client bundle is ~1.4 MB (~430 KB gzipped), dominated by three.js, astronomy-engine and the star catalogue. Code-splitting it is a worthwhile follow-up.

## Verifying live data

```
npm test -w server            # TLE parser against realistic Celestrak output
npm run check:live -w server  # end-to-end: real fetch -> parse -> pass prediction
```

`check:live` force-disables the fixture fallback, checks the ISS element epoch is
recent (a stale epoch is the biggest source of silently wrong predictions), and
prints the next few passes. It exits non-zero with an actionable message if
Celestrak is unreachable.

### Known environment constraint

`celestrak.org` is blocked by egress policy in some sandboxes — including Claude
Code cloud sessions on the default **Trusted** network access level, whose
allowlist covers package registries and GitHub but not third-party data sources.
The proxy answers `403` to `CONNECT`.

When that happens the server logs a warning and falls back to the bundled
fixture, and the UI shows the amber banner; nothing silently pretends to be real.
To allow it, set the environment's **Network access** to **Custom** at
[claude.ai/code](https://claude.ai/code), add the domains below, and tick *"Also
include default list of common package managers"* (otherwise `npm install`
breaks). The change applies to **new** sessions, not a running one.

```
celestrak.org         # orbital elements (required)
api.open-meteo.com    # cloud cover, if that feature is added
nasa3d.arc.nasa.gov   # NASA spacecraft models, if those are added
```

Everything else in the pipeline is verified independently of the network: the
pass mathematics against a fixed element set, the celestial transform against
astronomy-engine, and the TLE parser against realistic CRLF-delimited fixtures.

## Next steps

1. 2D polar sky-track chart for a selected pass (print/fallback view)
2. More satellite groups in the UI (Starlink trains, visual-brightest) with filtering
3. Optional Open-Meteo cloud-cover flagging
4. Code-splitting to cut the initial bundle
