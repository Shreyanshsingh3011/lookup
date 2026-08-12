# Lookup — satellite tracking & astronomy

A Heavens-Above-style satellite tracker: visible pass predictions, an interactive 3D sky dome, and (coming soon) a planetarium star chart.

## Live

| | |
| --- | --- |
| App | https://lookup-client.vercel.app |
| API | https://lookup-server-sand.vercel.app |
| API route index | https://lookup-server-sand.vercel.app/api |

⚠️ `lookup-server.vercel.app` — without the `-sand` — is **not this project**.
Vercel's `*.vercel.app` names come from one namespace shared across the whole
platform, and that one belongs to somebody else. It resolves and answers, so
using it by mistake looks like our API misbehaving rather than like a wrong
address. See [DEPLOYMENT.md](DEPLOYMENT.md).

## Status

**Milestone 1:** project scaffold, Celestrak TLE proxy/cache backend, satellite.js + astronomy-engine visible-pass prediction, and a pass-table UI for the ISS/space-stations group.

**Milestone 2:** interactive 3D sky dome with procedural satellite models, fading orbital trails, click/hover detail labels, camera aiming, and a 24-hour time scrubber with playback.

**Milestone 3:** planetarium layers — 5,044 stars to magnitude 6 with colour-index tinting, 88 constellation figures, named bright stars, and the naked-eye planets plus Sun and Moon, all toggleable.

**Milestone 4:** click a pass for its 2D polar sky-track chart, with a print view, and a "Show in 3D" jump that drives the dome to that pass.

**Milestone 5:** operator-supplied elements via `TLE_FILE`, element-age reporting on every response, and tests for the TLE parser and epoch decoder.

**Milestone 6 (this commit):** Open-Meteo cloud-cover forecasts flagged against each pass, and a lazy external-model loader with procedural fallback.

Not yet built: additional satellite groups (Starlink trains, visual-brightest) in the UI, daylight-pass listings, and a daylight sky in the dome.

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
- `GET /api/passes?lat=&lon=&alt=&groups=&days=&minEl=&maxMag=&weather=` — computes visible passes (satellite sunlit + observer in darkness + above the elevation threshold + brighter than the magnitude cutoff) over the next N days, annotated with forecast cloud cover. `weather=0` skips the forecast.

Both responses carry a `source` field describing element provenance, which the UI surfaces:

| `source`  | Meaning |
| --------- | ------- |
| `live`    | Fresh from Celestrak, or a still-fresh cache entry |
| `file`    | Operator-supplied elements from `TLE_FILE`; takes precedence over the network |
| `cache`   | Celestrak unreachable; serving a cache entry past its TTL |
| `fixture` | Celestrak unreachable and nothing cached; bundled dev-only elements. **Not valid for real predictions** |

Responses also carry `epoch: { newestAgeDays, oldestAgeDays }`, because *how old
the elements are* matters independently of where they came from — a successful
live fetch of week-old elements is no more trustworthy than a cached copy of the
same. The UI banner reports provenance and age together, and warns past seven
days whatever the source.

The fixture fallback is disabled when `NODE_ENV=production`; override either way with `ALLOW_TLE_FIXTURE=1` / `=0`.

### Supplying elements without network access

Point `TLE_FILE` at a Celestrak-format file (repeating name / line 1 / line 2
triples) to run against real elements offline:

```
TLE_FILE=./elements.txt npm run dev -w server
```

This is the intended path for air-gapped deployments, reproducible predictions in
tests, and for working in an environment whose egress policy blocks
`celestrak.org`. An explicit file wins over a live fetch — whoever set it meant
it — and the response says `source: "file"` rather than passing the elements off
as live. A missing file or one containing no parseable elements fails loudly
instead of silently falling back.

### Visibility and brightness model

Lives in `server/src/passes.ts`:

- Darkness windows are found by scanning observer sun altitude (astronomy-engine) coarsely, then satellite elevation is scanned finely inside those windows (satellite.js SGP4).
- Illumination uses satellite.js's `shadowFraction`, which models the penumbra rather than a hard cylindrical shadow, so a satellite fading into eclipse mid-pass is captured.
- Apparent magnitude approximates range, phase angle, and a per-satellite standard magnitude, then dims by the eclipsed fraction of the Sun's disc and by atmospheric extinction.
- **Extinction was missing until 2026-08-12, and its absence had a direction.** Passes spend most of their time low in the sky, low elevations are also where phase angles are most favourable, and nothing offset that — so the app reported the brightest moment of a pass at the point where the atmosphere was dimming the object most. Checked against production before the fix: an ISS pass peaking at 11.9° was quoted at magnitude −1.0, with the headline figure −1.4 taken from a sample at 4.5°, through eleven air masses. It now reads 0.2 at the peak, and the brightest sample moves up the sky where it belongs. Air mass uses Kasten–Young (1.0 overhead, 5.6 at 10°, ~38 at the horizon) rather than 1/sin(elevation), which diverges at the horizon and is already several per cent wrong by 10° — exactly where passes live. The coefficient, 0.25 mag per air mass, is a nominal clear-sky sea-level value in V: real extinction can be half that on a mountain or double it in summer haze, so it is the right order rather than a per-night truth, which is the same standing as the standard magnitudes it corrects.
- A pass reports *why* it ended — `set`, `shadow`, `daylight`, or `window` — taken from the first sample that failed the visibility test. It has to come from that terminating sample rather than the last visible one: every sample inside a pass is illuminated and above the horizon by construction, so inspecting the last visible sample could only ever report `set`. `window` means nothing ended the pass: the search ran out of window while the satellite was still up and lit. That case used to be reported as `set`, which the detail panel rendered as "sets below horizon" — false, and measurably so; see [Where a pass peaks](#where-a-pass-peaks).
- Sun position for satellite illumination comes from satellite.js (same TEME frame as the SGP4 output, so the two stay self-consistent); astronomy-engine handles observer twilight, where its topocentric horizon model with refraction is the better tool.

## 3D sky dome

- **Camera rig.** The camera orbits at a negligible radius (0.02) around the centre of a radius-100 dome, so the viewer stands at the observer's own position. Keeping that offset tiny against the dome radius means objects placed by azimuth/elevation render at correct angles with no parallax error. Because the orbit distance is pinned, zoom changes field of view instead of dollying — wheel on desktop, pinch on touch.
- **Trails** are re-derived analytically by propagating backwards from the display time rather than accumulating a rolling buffer of observed samples. That keeps them stateless and therefore correct while scrubbing or playing back, not only while time advances in real time.
- **Labels** use drei's `Html`, wrapped in a `FrontFacingHtml` guard. A perspective projection maps points behind the camera back onto the viewport inverted, so without the guard the southern cardinal labels show up while you're facing north.
- **Aiming.** The view swings to whatever is highest above the horizon when the sky goes from empty to occupied, and to any satellite you select; grabbing the sky cancels the animation so you never fight the camera.
- Satellite models are procedural Three.js geometry — an ISS-shaped truss (four solar array pairs, rounded module chain, white radiator panels), a Tiangong-shaped cross of Tianhe/Wentian/Mengtian each with their own wings, and a generic box-plus-wings bus for everything else — with optional external `.glb` models on top; see [Spacecraft models](#spacecraft-models).

## Cloud cover

`GET /api/passes` annotates each pass with `cloudCoverPercent`: the forecast
cloud cover at the pass maximum, from Open-Meteo's hourly data (free, no key).
The table shows it as a dial and a percentage; the pass detail spells it out.

Weather is **strictly advisory**. A forecast failure must never fail a pass
prediction, so every path degrades instead of throwing, the upstream call is
bounded at 5 s, and passes simply carry `null` when no forecast covers them —
which happens routinely, since passes are predicted 10 days out. Overcast passes
are still listed, because forecasts are wrong often enough that hiding them
would be worse than flagging them.

Forecasts are cached for an hour per location rounded to 0.1°, and failures are
remembered for five minutes so an unreachable service isn't retried on every
request. `WEATHER_FILE` loads a forecast from a local JSON file instead,
mirroring `TLE_FILE`.

The response shape is pinned by a test fixture — a genuine response captured by
hand from the live service (that host is blocked from the environment this was
built in) rather than one written from documentation. `parseCloudForecast`
still validates the contract explicitly and throws a specific error if the
shape ever changes, rather than silently producing empty forecasts.

## Spacecraft models

Satellites render as procedural Three.js geometry by default — no external
assets required. Three shapes, chosen by name match in `SatelliteMarker.tsx`:

- **ISS-family** (ISS/Zarya/Nauka/Poisk/docked-vehicle entries): a 3.4-unit
  integrated truss, four solar array pairs, a rounded module chain with a
  docking-node sphere, and white radiator panels offset vertically from the
  truss so they read as a distinct structure rather than overlapping the blue
  arrays.
- **Tiangong-family** (CSS/Tianhe/Wentian/Mengtian): Tianhe's core cylinder
  along X with Wentian and Mengtian docked radially along Z, each with its own
  solar wings extending perpendicular to its own body axis — a cross/windmill
  silhouette, deliberately not just a smaller ISS.
- **Everything else**: a generic box-plus-wings bus.

All solar panels share one small canvas-drawn grid texture (a solar-cell look
without extra geometry), generated once and reused across every satellite
rather than per-instance.

To use a real model instead, convert it to `.glb`, drop it in
`client/public/models/`, and either add an entry to `MODEL_URLS` in
`client/src/lib/satelliteModels.ts` or set
`VITE_SATELLITE_MODELS='{"25544":"/models/iss.glb"}'` at build time.

No assets are vendored here. NASA publishes spacecraft models at
[nasa3d.arc.nasa.gov/models](https://nasa3d.arc.nasa.gov/models), but mostly as
`.3ds`/`.obj`/`.stl` rather than glTF, and they are large, so converting and
committing them is a deployment decision rather than something baked in — the
procedural geometry above exists precisely so that decision isn't required.

Loading is lazy, cached per URL, and each marker gets its own clone (an
`Object3D` has one parent, so sharing would make satellites steal the model from
each other). Arbitrary model units are normalised by fitting the longest axis to
a fixed size — a raw model is as likely to be invisible as to swallow the sky. A
missing or broken model logs a warning and falls back to procedural geometry: it
is a cosmetic downgrade, not a reason to take the sky view down.

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

The catalogue is J2000 and is precessed to the mean equinox of date before it
is drawn. This used to say the effect was "sub-arcminute … smaller than a
rendered star glyph", which was wrong by a factor of about twenty: measured
against astronomy-engine at the current epoch, leaving it out displaced
Betelgeuse by 0.354°, four to five pixels at the default field of view, and it
grows by roughly 0.14° a decade. It also put the stars in a different frame from
the planets, which come from astronomy-engine as of-date coordinates — so two
layers of the same sky disagreed.

Precession rides inside the same 3×3 that carries the horizontal rotation, so it
costs one extra matrix multiply per rebuild and nothing per star. The star
labels, the constellation labels, the "what am I looking at" boresight match and
the small-body positions apply it too, since anything drawn against a precessed
sky has to move with it. Cross-checked against astronomy-engine's independent
star pipeline: worst-case agreement improves from 0.354° to 0.007°.

Nutation and stellar aberration are deliberately omitted — together about 25
arcseconds, which is the residual in that figure. Atmospheric refraction is not
applied either, matching how satellite elevations are computed elsewhere in the
app. The Milky Way band and the meteor radiants are still drawn from J2000
coordinates: both are diffuse or approximate enough that a third of a degree
does not change what you see.

### What has been checked against an independent source

Four layers had never been verified against anything outside the app. Audited
2026-08-12, with the checks kept as tests where they could be:

- **Planet apparent size.** Observed minimum and maximum angular diameters over
  800 days against published ranges: Mercury 4.6-12.1" (published 4.5-13),
  Venus 9.6-61.1" (9.7-66), Jupiter 30.8-46.6" (29.8-50.1), Saturn 15.8-20.0"
  excluding rings (14.5-20.1), Moon 32.6' (29.4-33.5'). Mars reaches only 13.8"
  in this window against a published maximum of 25.1", which is correct rather
  than wrong: 25" needs a perihelic opposition, and the last was 2018 with the
  next in 2035.
- **The galactic frame.** Pole to origin comes out 90.0001°, and four objects
  with published galactic coordinates round-trip to better than 0.05° — Sgr A*
  lands on 359.944, -0.046 exactly. Note the origin constant is the galactic
  coordinate origin, not Sgr A* itself, which is the correct choice for defining
  the frame and differs from the black hole's position by about a hundredth of a
  degree.
- **Moon illumination**, against the fraction implied by its elongation from the
  Sun, (1 - cos elongation) / 2, across four phases: agreement within 0.002.
- **AR pointing.** The closed form in `lookDirectionFrom` was re-derived by hand
  as the third column of Rz(alpha)Rx(beta)Ry(gamma) and matches, including the
  `360 - compassHeading` conversion; twelve existing tests cover the hand-checked
  cases.

Audited again 2026-08-12, two more layers that had never been checked outside the
app:

- **The ground track**, against geometry rather than against itself. An observer
  standing at the sub-satellite point must see the satellite at 90°, which links
  `subSatellitePoint` to the look-angle path and breaks on any frame or GMST
  error: across 468 samples over 12 real objects it comes out **90.00000°**. An
  observer at the footprint edge must see it on the horizon: within 0.073°, about
  8 km on the ground, which is the spherical-Earth approximation `footprintRadiusDeg`
  makes and is well below what the map can show. The subsolar point lands on the
  Sun's declination at both equinoxes (0.000°, −0.000°) and both solstices (23.439°,
  −23.437°), and its longitude at 12:00 UTC traces the equation of time across a
  year, peaking at 4.10° — 16.4 minutes, in early November, the correct sign and
  magnitude. Nothing wrong found; it is recorded because "checked" and "never
  looked at" had been indistinguishable.
- **The altitude convention**, which was wrong. `orbitalElementsFromTle` subtracted
  the mean Earth radius, 6371 km, where the Space-Track and CelesTrak SATCATs and
  everything built on them subtract the *equatorial* radius. Every perigee and
  apogee the app reported was 7.1 km above the published figure for the same
  object, and nothing in the app could have revealed it. The anchor is
  geostationary altitude: canonically 35,786 km, a figure *defined* as 42,164 −
  6,378, so a GEO element set says outright which radius is in use — it was
  reading 35,793. Fixed, with the canonical value pinned by a test. Worth being
  precise about what the corrected number is not: height above a sphere is not
  height above the ground, the ellipsoid runs from 6378 km at the equator to 6357
  at the poles, and measured against the WGS84 geodetic height `subSatellitePoint`
  reports, the quoted perigee still sits up to 9 km high and the quoted apogee up
  to 21 km low. Those are catalogue-convention figures, not the altitude at an
  instant.

One hypothesis in that pass did not survive contact. The perigee bias runs in the
direction that under-reports decay risk, and it feeds the 600 km "stable" gate, so
I expected to find objects declared stable that were not. Across 644 real
fragments, 60 of them in the 560–640 km band where a bias of that size could flip
the verdict, exactly one crossed it — quoted at 600.8 km against a lowest geodetic
altitude of 599.5. A kilometre either side of a rule-of-thumb threshold is not a
defect, and the convention fix stands on the convention, not on that.

The earlier audit found one real gap, since fixed: the rendered view ignored roll. The
camera was aimed through OrbitControls, which parameterises it by azimuth and
polar angle about a fixed world up — so there was nowhere in that description to
put a rotation about the view axis. The dome pointed correctly at any attitude
while the sky's rotation on screen was only right in portrait; held sideways, the
constellations came out turned by up to 90° from what was actually behind the
handset.

`lookDirectionFrom` now reports `rollDeg` alongside azimuth and elevation, eased
through the same wrap-aware smoothing so it cannot spin the sky at the ±180°
seam, and `OrientationCamera` drives the camera directly rather than through the
controls. Two details that are easy to get wrong and are therefore pinned by
tests: the up vector is rebuilt from the three smoothed angles rather than
carried as a vector — a vector cannot be eased between samples without drifting
off the unit sphere — and that reconstruction is checked against the rotation
matrix's own second column across ~1,900 attitudes, agreeing to better than
0.001°. The camera write happens in a frame callback rather than an effect,
because drei's OrbitControls calls `update()` every frame at priority −1 and
would otherwise overwrite it.

Verified in a browser with synthesised `DeviceOrientationEvent`s: portrait leaves
the camera's up as world up, and the two landscape holds tilt it 90° to east and
west respectively — opposite signs, so the sky rolls the correct way rather than
mirrored — with the pointing direction identical in all three.

### Planets

Sun, Moon, Mercury, Venus, Mars, Jupiter and Saturn come from astronomy-engine
per frame (seven bodies is far too cheap to bother optimising), with apparent
magnitude and, for the Moon, illuminated fraction. Uranus and Neptune are
omitted: at magnitude 5.7+ they add clutter without being what anyone scanning
the sky is looking for.

## Where a pass peaks

Both pass predictors — the visible one on the server, the radio one in the
browser — scan on a grid and used to report whichever grid sample sat nearest
each extreme, unrefined. The horizon crossings were refined; the peak and the
closest approach were not. Both now pin the extreme by ternary search over the
bracket the grid already supplies. Measured 2026-08-12 against fine scans of the
same intervals, with live elements.

**Radio passes** (30 s grid, 259 passes over real Fengyun-1C fragments). The
reported peak elevation ran up to 6.6° below the truth — one near-overhead pass
came out as 81.6° when it reached 88.2° — and the closest approach landed
*exactly* on a 30 s boundary in all 259 cases, up to 15 s from the real one. That
last one is the expensive one. Closest approach is where the Doppler crosses
zero, and 15 s out leaves the shift **1,490 Hz** from zero at 435 MHz, worst
case, against a mean of 319. For scale, the file already models the observer's
own rotation with the Earth because that term is worth about 675 Hz and leaving
it out "would be a visible error rather than a rounding one" — the error from
rounding the moment to half a minute was twice that. Now: peak within 0.000°,
closest approach within 0.1 s, Doppler within 1 Hz.

**Visible passes** (10 s grid, 180 passes over 14 objects from the live bright
catalogue). The elevation cost was small — 0.035° mean, 1.4° worst, which nobody
standing outside would notice. The *direction* was not. Azimuth sweeps fastest
exactly where elevation peaks, so the reported peak azimuth ran up to **65°** out
and **20 of 180 passes named the wrong compass point**. Fifteen of those were
below 80° elevation, where a direction is still something an observer can act on:
one pass peaking at 78° was reported as peaking due west when it peaked
west-southwest. Telling someone where to look is the pass table's whole job. Now:
0 of 180 wrong, peak azimuth within 2.3° and that residual on an 89.5° pass where
azimuth is ill-conditioned rather than mis-sampled.

**Pass boundaries.** The start and end were the last things read straight off the
grid. Over 19 real passes against the same scan run twenty times finer, the start
came out up to 9 s late (4.4 s on average), the end up to 9.5 s early, and one
pass's duration was 16 s short. The elevation reported at the boundary was wrong
to match — passes that end by *setting* were ending at up to 0.6° rather than at
the horizon. Both ends are bisected now: visibility is a boolean that flips once
inside the bracket the grid supplies, so bisection finds the flip without needing
to know which of the three conditions moved, which matters because a pass can
start by rising, by leaving Earth's shadow, or by the sky getting dark enough.
Now within 0.03 s, durations exact, and every setting pass ends at 0.0°.

Ordering turned out to be load-bearing, and I got it wrong first. Refined
boundaries can land outside the grid samples, so pinning the peak against the
grid samples let a pass that ends by entering shadow *while still climbing*
report a final elevation above its own peak — caught by an existing test
("passes come back in time order and internally consistent") rather than by me.
Boundaries are located first and the peak is searched over that true interval,
with the peak taken as the maximum of the search and both endpoints so the
invariant holds regardless.

**"Sets below horizon" was sometimes false.** Chasing the boundary fix turned up
a separate honesty bug: `endReason` used `"set"` for two different things — the
satellite dropping below the horizon, and the search simply running out of window
mid-pass — and the detail panel rendered both as "sets below horizon". Rare, but
false: over ten days of the bundled catalogue from Singapore, one pass of 155 was
still **26.7° up and sunlit** when its span closed and the app said it had set.
Eccentric orbits produce it, since they can stay above the horizon longer than a
scanned stretch. There is a fourth reason now, `"window"`, rendered as "still up
when the search ended".

**Radio horizon crossings.** Same defect class, worse failure. The crossing search
walked outward exactly thirty one-second steps and returned wherever it had got
to — fine for an interior crossing, silently wrong for a pass *already under way*,
which is the first thing you see if you open the panel mid-pass. There the first
sample is the search's own start instant and the rise is further back than thirty
seconds, so the reported rise was just "thirty seconds before the window". Over
259 real passes the one that was already up had its rise reported **258.6 s late**
(4m19s) and its duration 259 s short — 669 s against a real 928 s — with nothing
marking the number as a guess. The bracket is established by stepping outward
until an instant outside the pass is found, then bisected: now within 0.03 s, and
a pass in progress reports the rise it actually had, in the past, where it belongs.
Worth noting my first measurement of this said 39.99 s — my own audit bracket had
clipped it, and widening the bracket was what revealed the real 258.6 s.

Two things worth recording about this audit. The refinement bracket is clamped to
the visible stretch of the pass, which is not tidiness: a pass can end in Earth's
shadow well before the geometry peaks, and searching past the last visible sample
would report a peak the observer never saw lit — a worse answer than the coarse
one. And one hypothesis of mine did not survive measurement. Comparing a
grid-sampled peak against the 10° minimum-elevation gate should, in principle,
discard passes whose real peak clears 10°; across 180 real passes it discarded
none, because a pass peaking near 10° has gentle curvature there and is sampled
accurately. The gate is refined before it is applied now regardless, but the
defect I went looking for was not the one that was there.

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

## Close-approach scan

A geometric proximity screen over every pair of tracked objects, reporting the
closest each pair comes within 24 hours if that is under 25 km. Explicitly not a
collision warning: there is no covariance here, and a week-old TLE carries
kilometres of along-track error in its own right, larger than the distances being
reported.

It was, until 2026-08-12, unsound rather than merely coarse. Both trajectories
were sampled every 90 seconds and the smallest **sampled** separation was
reported as the miss distance, with no refinement. Two objects in opposing low
orbits close at up to about 15.8 km/s, so 90 seconds lets them move 1,400 km
relative to each other between looks — an error two orders of magnitude past the
25 km being screened on. Measured against half-second brute force over 60 real
Fengyun-1C fragments across 24 hours: **13 pairs genuinely came within 25 km, the
closest at 4.2 km, and the scan reported none of them.** The panel said "no pair
came within 25 km" and that was false.

Tuning the interval does not fix it. Keeping between-sample motion small next to
a 25 km threshold needs a step under 1.6 seconds, or 54,600 samples per pair per
day. So the step is adaptive: from a separation of *d*, the pair cannot reach the
threshold in less than (*d* − threshold) / 15.8 seconds whatever they are doing,
and stepping by that much therefore cannot step over an approach. Far apart the
steps run long and cost about what the fixed one did; as a pair converges they
shrink on their own. The bracketed minimum is then pinned by ternary search,
separation being smooth and single-dipped across one encounter.

Re-measured after the change: all 13 real approaches found, worst error against
brute force 0.23 km, for 3.9 s against the old 3.0 s — 28% more work to stop
missing everything. Verified again at 100 km and 500 km thresholds, where the old
sampling missed 81 of 111 and 88 of 563 respectively and the new one misses none.

That measurement also exposed a second defect, in the altitude-band pre-filter
that keeps an all-pairs scan tractable. Pairs whose perigee/apogee bands are
further apart than the threshold cannot possibly meet it and are skipped before
either is propagated — but the margin was a flat 100 km regardless of what the
caller asked to screen on. Sound at 25 km; at 500 km it threw away ten genuine
approaches, the closest 195 km, and threw them away before propagating anything
so nothing downstream could recover them. The margin now scales with the
threshold, keeping 100 km of slack for how far the bands themselves drift over
the window.

The fixtures pinning all of this are four real Fengyun-1C fragments rather than
the synthetic pairs used elsewhere in that test file, and deliberately so: an
identical-orbit clone is close at every instant, so any step size finds it. Only
a real, brief encounter tells a scan that resolves approaches apart from one that
steps over them.

Confirmed end to end in a browser as well, not only in the library: the two
fragments pasted into the app's own custom-TLE box, with the page clock pinned via
`page.clock.setFixedTime` so the window the scan opens contains the encounter. The
panel reports 4.2 km at 01:27, matching the brute-force minimum of 4.2126 km at
01:27:12.5Z. Pinning the clock was necessary rather than convenient: run at the
real wall clock this pair reports nothing, and correctly so — their relative phase
drifts *upward* through 180° over that particular day, so the separation only ever
grows from the 11,538 km it starts at. Two objects in low orbit are not obliged to
meet within any given 24 hours, which is worth stating because assuming otherwise
is what made that empty result look like a bug at first.

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

`test` covers the TLE parser and the epoch decoder (including the NORAD two-digit
year pivot, where prefixing "20" would misdate historical elements by a century).

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

1. Daylight-aware dome (fade sky/stars by sun altitude) and a daylight-pass listing — right now a pass in daylight is silently omitted, and the dome renders full night regardless of the actual time of day
2. Caching or a background job for pass prediction at Starlink scale — confirmed roughly linear in satellite count (1.6s at 22 objects, 14.8s at 200), so a 1000+ group isn't viable as a synchronous request yet
3. More satellite groups in the UI (Starlink trains, visual-brightest) with filtering, once (2) makes them affordable
4. Code-splitting to cut the initial bundle
5. Tests for the pass-prediction core itself (`passes.ts`) — currently covered only by manual cross-checks against real elements, unlike the parser and epoch modules
