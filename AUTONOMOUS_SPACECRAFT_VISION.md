# Lookup — Autonomous Spacecraft Navigation & Safety Vision
**Sthapana Technologies | Non-confidential concept and development target | 12 November 2026**

> **Status: proposed R&D vision, NOT an operational capability.** Lookup currently provides an astronomy/satellite-tracking experience and educational orbital analyses. It does **not** autonomously navigate a spacecraft, detect hazards from flight cameras, issue thruster commands, or provide flight-grade conjunction warnings.

## Mission

Develop a modular, integrity-aware spacecraft navigation and safety platform that can **estimate where a vehicle is, perceive relevant surroundings, plan where it should go, and safely manage authorised manoeuvres** with reduced dependence on continuous ground control.

Our target is a civil-space product for small satellites, inspection vehicles, in-orbit servicing, cislunar missions and, eventually, deep-space probes. The public Lookup application can mature into an explainable research **simulation and operator-education workbench**, while flight software and sensitive underlying intellectual property are developed and validated separately.

## NASA AstroNav as a capability benchmark — not our achievement

NASA describes AstroNav as an **in-development** onboard navigation technology demonstration targeted for the **late-2027 CAPSTONE 02 lunar-orbit mission**. Its publicly described goal is to use optical observations of stars, planets and asteroids, potentially complemented by precise Earth-origin ranging/Doppler measurements, with probabilistic estimation to derive spacecraft position and velocity and design navigation manoeuvres onboard. It seeks to reduce dependence on routine Earth-based navigation updates.

Our long-term **baseline objectives** are:
1. Onboard absolute and relative position/velocity estimation where observability permits.
2. Optical/celestial bearing extraction and known-target association.
3. Fusion of camera observations, IMU/attitude measurements and available orbit/radio data.
4. Explicit covariance, uncertainty and integrity monitoring.
5. Trajectory estimation, mission-specific planning and manoeuvre feasibility assessment.
6. Graceful operation during interrupted/late ground communication within validated limits.
7. Progressive extension from Earth orbit to cislunar and deep-space environments.

**Sources:** [NASA AstroNav](https://www.nasa.gov/mission/astronav/); [NASA autoNGC](https://www.nasa.gov/communicating-with-missions/autongc/). These are independent NASA programmes, **not** Sthapana partnerships or endorsements.

## Proposed Sthapana extensions

**A. Vision and environmental awareness**
- Camera-based detection and tracking of **observable** spacecraft, features and selected hazards.
- Multi-frame relative motion estimation with stated visibility, range and uncertainty limits.
- Fusion with catalogue/ephemeris and cooperative navigation information where available.

**B. Predictive proximity safety**
- Predict relative trajectories and screen candidate conjunctions and approach corridors.
- Treat **orbit uncertainty, object size, timing, sensor freshness and manoeuvre authority** as first-class inputs.
- Distinguish geometric proximity from a statistically supported collision-risk estimate.
- Do **not** promise that a camera can react fast enough to dodge arbitrary orbital debris.

**C. Integrity-bounded autonomy**
- Evaluate data integrity and mission constraints before planning or recommending a manoeuvre.
- Provide explainable `monitor / advisory / hold / request-ground / reject-plan` states.
- Advance to control commands only after independent verification, hardware-in-the-loop testing, system-level safety review and mission-authorised flight integration.

**D. Modular commercial integration**
- A hardware-agnostic operator-facing software core with isolated sensor adapters, navigation filters, planning modules and spacecraft-specific actuation adapters.
- Start with simulation and non-actuating decision support; **no physical spacecraft control is part of current Lookup**.

## End-state functional chain

```text
Optical imagery + celestial observations + IMU + orbit/radio observations
                                |
                       Sensor provenance
                                |
                 Detection / association / fusion
                                |
             State estimate + uncertainty + integrity
                                |
            Relative motion and mission risk evaluation
                                |
               Feasible, constraint-checked planner
                                |
                 Safety / authority / go-no-go gate
                                |
     Simulator or operator recommendation (current target)
                                |
      Verified spacecraft control interface (future only)
```

## Where the existing Lookup code helps

The current public application contains useful **research foundations**, not validated flight subsystems:
- `client/src/lib/celestial.ts`, `celestialMath.ts`, `deviceOrientation.ts`: celestial/orientation mathematics and device-facing orientation handling.
- `client/src/lib/orbitalMechanics.ts`: educational orbital mechanics.
- `client/src/lib/conjunctions.ts` and `client/src/components/ConjunctionScan.tsx`: approximate **TLE-based geometric close-approach** screening. The UI correctly warns this is **not** a collision-warning service.
- `client/src/components/DebrisScreen.tsx`: debris catalogue/age and provenance presentation.
- `client/src/components/sky/SkyDome.tsx`: 3D visualization.
- `client/src/components/OrbitAdvisor.tsx`: orbit-planning guidance, **not** spacecraft command authority.

These offer a base for public-facing **simulated research demonstrations**, not certified navigation.

## Development stages and claims

| Stage | Deliverable | Honest claim after verification |
|---|---|---|
| 0 — Specification | Threat model, simulation scope, interface definitions and test dataset | Published non-confidential research roadmap |
| 1 — Optical estimation | Reproducible synthetic camera/landmark observations and navigation estimator | Simulator runs with measured accuracy and uncertainty |
| 2 — Perception/fusion | Image-target tracking and IMU/orbit fusion under defined conditions | Tested relative/absolute estimation in simulation |
| 3 — Risk screening | Conjunction and proximity evaluation incorporating uncertainty and data quality | **Advisory** risk assessment on benchmark scenarios |
| 4 — Safe planning | Constrained manoeuvre suggestions and rejection/safe modes | Closed-loop **simulated** control only |
| 5 — Laboratory validation | Hardware-in-the-loop with sensors and a representative flight computer | Laboratory-tested subsystem under defined limitations |
| 6 — Flight path | Partner mission, safety case, mission assurance, flight authorisation | Flight demonstration **only if achieved** |

No fixed completion dates, Technology Readiness Levels or performance figures should be claimed without evidence. Record experimental assumptions, failure cases, repeatability, uncertainty calibration and independently verified results.

## Important safety and product boundaries

1. **Never attach public Lookup simulation output to live spacecraft thrusters or attitude-control actuators.**
2. Do not present TLE-based close-approach scans as collision probability, actionable warnings or autonomous avoidance.
3. Do not assert position/range observability from a single image when it is not physically observable.
4. Model communication delay, camera limits, sensor faults, ephemeris age, thrust limits and operational permissions.
5. Fail safe under ambiguous observations, stale data, unbounded uncertainty or missing authorisation.
6. Treat patents, algorithms, confidential architecture, claim language, unpublished technical details, and any cross-border controlled information as **separate private material**; do not commit them to the public repository.

## ESA BIC UK conversation

The initial ask is a UK-based **civil space** partnership to help validate optical navigation, sensor fusion, integrity monitoring and eventually autonomy, with laboratory access, technical mentors and UK-incubation eligibility guidance.

**Suggested one-line pitch:** “Sthapana is progressing from a celestial-referenced navigation research concept toward an integrity-aware optical navigation and spacecraft-safety platform, starting with validated simulation and progressing through hardware demonstration toward a future autonomous flight module.”

## Implementation plan

See [AUTONOMY_ENGINEERING_ROADMAP.md](AUTONOMY_ENGINEERING_ROADMAP.md) for work packages, acceptance gates and how to integrate the research workbench with Lookup without misrepresenting current capability.
