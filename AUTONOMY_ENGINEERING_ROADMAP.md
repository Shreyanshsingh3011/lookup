# Lookup — Autonomous Navigation Research Roadmap
**Owner: Sthapana Technologies | Published 12 November 2026 | Non-confidential**

> This roadmap describes **proposed development work**, not features that are currently live. Lookup must remain an educational/simulation tool until independent validation and any future flight-software assurance are complete.

## Current foundations (verified in the repository)

| Existing component | Appropriate use | Current limitation |
|---|---|---|
| `client/src/lib/deviceOrientation.ts`, `celestial.ts`, `celestialMath.ts` | Reference-frame and orientation experiments | Phone/sky orientation ≠ flight-validated spacecraft attitude |
| `client/src/lib/orbitalMechanics.ts` | Simulated orbital mechanics | Not a flight dynamics or manoeuvre authority stack |
| `client/src/lib/conjunctions.ts` | Geometric close-approach demonstrations | No object covariance; not collision probability |
| `client/src/components/ConjunctionScan.tsx` | Explain limitations of pairwise proximity screens | 24-hour TLE-based screening only |
| `client/src/components/DebrisScreen.tsx` | Data provenance, freshness and debris awareness | Not direct flight-camera perception |
| `client/src/components/sky/SkyDome.tsx` | Visualise simulated spacecraft state | Ground-observer sky representation, not a spacecraft-native camera |
| `client/src/components/OrbitAdvisor.tsx` | Education and mission guidance | Not executable GNC |

## Work packages

### WP0 — Requirements, reference architecture and data (first)
- Define civil-space test scenarios: Earth-orbit observation, formation/proximity operations, optional cislunar extensions.
- Inventory current simulation data sources, frames, units, coordinate transformations, licences and freshness semantics.
- Agree a **simulation-only boundary**; prohibit network/serial/physical actuator connections.
- Specify observational limitations, failures, spacecraft dynamics and integrity-state semantics.
- Establish repeatable test datasets, ground-truth generation and experiment logs.

**Acceptance:** written use cases, explicit non-goals, common units/frames, safe-mode behaviours, and a reproducible dataset. No reliance on hypothetical flight data.

### WP1 — Simulated optical navigation
- Add a synthetic camera model and reference-target ephemeris/landmark catalogue.
- Simulate detections, occlusion, lens/noise effects and missed/false observations.
- Implement testable optical observation interfaces; estimate state only where measurements are observable.
- Compare estimated state with simulator truth; track accuracy, coverage and uncertainty calibration.

**Acceptance:** automated deterministic regression tests, failure cases, documented error distributions and known observability limits.

### WP2 — Perception and multi-sensor fusion
- Add frame-by-frame association, object/landmark tracking and simulated IMU measurements.
- Fuse measurement streams with explicit timestamps, source provenance and uncertainty.
- Detect stale/out-of-order inputs, inconsistent observations and loss of track.
- Compare fusion with and without each sensor using controlled experiments.

**Acceptance:** quantitative performance report across nominal, occluded, delayed and sensor-fault scenarios; no unsupported confidence claims.

### WP3 — Relative motion and proximity-risk advisory
- Provide simulated ownship/target tracks, closest-approach estimates and relative geometry.
- Move beyond current TLE-only proximity checks by modelling covariance and data-age limitations.
- Display a risk/quality explanation and uncertainty; mark unavailable risk estimates as **unknown**, not zero.
- Define permitted planner states: `MONITOR`, `ADVISE`, `HOLD`, `REQUEST_REVIEW`, `REJECT`.

**Acceptance:** no actionable collision warning from public TLE-only data; tests reject stale/uncertain input and distinguish proximity from probability.

### WP4 — Constraint-checked mission planning in simulation
- Generate *candidate* trajectories or avoidance options within simulated thrust, fuel, pointing, timing and mission constraints.
- Verify manoeuvre feasibility and model post-manoeuvre outcomes, including uncertainty.
- Add visible gates requiring operator approval for any simulated command execution.
- Keep all outputs as **simulated decision support**; no external command adapters.

**Acceptance:** deterministic scenarios where unsafe options are rejected, logs explain why, and no code path can reach physical spacecraft hardware.

### WP5 — Laboratory and partner validation (separate future programme)
- Hardware-in-the-loop sensor/camera and representative onboard compute trials.
- Bench-test timing, fault handling, radiation/environmental assumptions, reliability and performance.
- Independent review, restricted/IP review, safety case and mission-interface approval.
- Pursue a partner-led orbital demonstration only after objective evidence supports it.

**Acceptance:** test reports, review approvals and defined mission assurance; *no flight-readiness claim before completion*.

## Proposed public Lookup architecture

Keep autonomy experimental code **behind a separate feature boundary**; for example:

```text
client/src/research/autonomy/
  types.ts              // simulated measurement, estimate, uncertainty, provenance
  scenario.ts           // deterministic simulator inputs / test data
  opticalObservations.ts
  integrityStates.ts    // quality and approval state machine
  riskAdvisory.ts       // clearly labelled non-operational analysis
  *.test.ts             // deterministic edge cases

client/src/components/
  AutonomyResearch.tsx  // simulation-only status, data quality, explanations
```

Names are **proposals**, not assertions that these files exist. Changes to the app should be staged as independently tested PRs. Reuse existing data objects only when reference frames, epochs, units and uncertainty semantics match; do not silently repurpose ground-observer TLEs as flight navigation solutions.

## Demonstration sequence for ESA BIC UK

1. Show the existing celestial/sky and satellite-position visualisations.
2. Show Lookup's explicit warning that geometric close approaches are **not** operational collision alerts.
3. Present a proposed reproducible simulation: optical observations → estimate/uncertainty → integrity decision → *advisory-only* planned trajectory.
4. Request technical collaboration for spacecraft optical navigation, sensor calibration, simulation benchmarking and UK laboratory/HIL validation.
5. Discuss eligible UK subsidiary/spin-out structures and background-IP separation before sharing detailed proprietary methods.

## Metrics to measure, not promise

- State-estimation position/velocity/attitude error with documented frames, truth, test conditions and uncertainty calibration.
- Perception precision/recall and track continuity under controlled range, illumination, motion and sensor-noise conditions.
- Risk-screening false positive/false negative behaviour **with** defined covariance assumptions.
- Planning feasibility and constraint violations on representative cases.
- Fail-safe transition coverage, rejection of stale/inconsistent data, execution latency and compute budget.
- HIL/flight metrics only after appropriate validation.

**Never claim “self-driving satellite”, flight autonomy, active optical collision avoidance or a readiness level without corresponding tests.**

## Public sources / positioning

- [NASA AstroNav](https://www.nasa.gov/mission/astronav/) — benchmark for onboard optical/radio-assisted autonomous navigation; still in development, late-2027 lunar demonstration target.
- [NASA autoNGC](https://www.nasa.gov/communicating-with-missions/autongc/) — related onboard guidance, navigation and control architecture.
- [Lookup vision](AUTONOMOUS_SPACECRAFT_VISION.md) — product direction and research boundaries.

**IP note:** Keep unpublished patented embodiments and restricted engineering details out of this public repository. Any protected implementation should be handled through appropriately restricted private review and source control.
