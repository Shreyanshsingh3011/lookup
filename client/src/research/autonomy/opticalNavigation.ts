/**
 * Simulated planar bearing-only navigation, for the public Lookup research UI.
 *
 * This is NOT a celestial navigation, camera-vision, flight GNC or collision-
 * avoidance subsystem. All landmarks, measurements and ground truth are
 * synthetic; 2-D known landmarks and several independent bearings make the
 * position observable. A single direction toward a star does not locate a
 * spacecraft. Never connect this module to a physical actuator.
 */

export interface PointKm { x: number; y: number }
export interface Landmark { id: string; name: string; positionKm: PointKm }
export interface BearingObservation {
  landmarkId: string;
  bearingDeg: number;
  ageSeconds: number;
  sigmaDeg: number;
  detected: boolean;
}
export type ScenarioId = 'nominal' | 'noisy' | 'occluded' | 'inconsistent' | 'stale' | 'degenerate';
export interface Scenario {
  id: ScenarioId;
  label: string;
  description: string;
  groundTruthKm: PointKm;
  landmarks: Landmark[];
  observations: BearingObservation[];
}
export interface NavigationEstimate {
  status: 'ADVISORY' | 'HOLD';
  reason: string;
  positionKm: PointKm | null;
  residualRmsKm: number | null;
  uncertainty95Km: number | null;
  conditionNumber: number | null;
  usedObservations: number;
  rejectedObservations: number;
}

const RAD = Math.PI / 180;
const MAX_AGE_SECONDS = 30;
const MAX_CONDITION = 50;
const MAX_UNCERTAINTY_KM = 4;
const DEFAULT_POSITION: PointKm = { x: 8, y: 3 };
const BASE_LANDMARKS: Landmark[] = [
  { id: 'A', name: 'Beacon A', positionKm: { x: -48, y: -38 } },
  { id: 'B', name: 'Beacon B', positionKm: { x: 76, y: -26 } },
  { id: 'C', name: 'Beacon C', positionKm: { x: -18, y: 87 } },
  { id: 'D', name: 'Beacon D', positionKm: { x: 91, y: 78 } },
];
export const SCENARIOS: ReadonlyArray<{ id: ScenarioId; label: string }> = [
  { id: 'nominal', label: 'Nominal optical fix' },
  { id: 'noisy', label: 'Noisy observations' },
  { id: 'occluded', label: 'Occluded landmarks' },
  { id: 'inconsistent', label: 'False / inconsistent detection' },
  { id: 'stale', label: 'Stale sensor observations' },
  { id: 'degenerate', label: 'Poor viewing geometry' },
];

export function bearingFrom(position: PointKm, landmark: PointKm): number {
  return Math.atan2(landmark.y - position.y, landmark.x - position.x) / RAD;
}

/** Same input always produces identical observations, without randomness or clocks. */
export function makeScenario(id: ScenarioId): Scenario {
  const groundTruthKm = { ...DEFAULT_POSITION };
  const landmarks = id === 'degenerate'
    ? BASE_LANDMARKS.map((lm, i) => ({ ...lm, positionKm: { x: 28 + i * 30, y: 3 } }))
    : BASE_LANDMARKS.map(lm => ({ ...lm, positionKm: { ...lm.positionKm } }));
  const errors = id === 'noisy' ? [0.42, -0.58, 0.37, -0.45] : [0.06, -0.08, 0.04, -0.03];
  const observations = landmarks.map((lm, i): BearingObservation => ({
    landmarkId: lm.id,
    bearingDeg: bearingFrom(groundTruthKm, lm.positionKm) + errors[i] + (id === 'inconsistent' && i === 1 ? 15 : 0),
    ageSeconds: id === 'stale' && i < 3 ? 180 : 2,
    sigmaDeg: id === 'noisy' ? 0.8 : 0.2,
    detected: id !== 'occluded' || i === 0,
  }));
  const descriptions: Record<ScenarioId, string> = {
    nominal: 'Four known landmarks supply independent synthetic optical bearings.',
    noisy: 'All four landmarks are detected, but angular measurements are less precise.',
    occluded: 'Only one landmark remains visible; position cannot be triangulated.',
    inconsistent: 'One observation has a deliberate 15° false association.',
    stale: 'Three observations exceed the 30-second freshness limit.',
    degenerate: 'All known landmarks lie along one bearing line; the geometry is unobservable.',
  };
  return {
    id, label: SCENARIOS.find(s => s.id === id)!.label,
    description: descriptions[id], groundTruthKm, landmarks, observations,
  };
}

/**
 * Unweighted least-squares intersection of landmark-to-observer bearing lines.
 * The approximate uncertainty radius uses a conservative range-scaled angular
 * error model; it is illustrative, NOT a flight-calibrated statistical bound.
 */
export function estimateOpticalPosition(scenario: Scenario): NavigationEstimate {
  const known = new Map(scenario.landmarks.map(lm => [lm.id, lm]));
  const accepted = scenario.observations.filter(o =>
    o.detected && Number.isFinite(o.bearingDeg) && Number.isFinite(o.ageSeconds) &&
    o.ageSeconds >= 0 && o.ageSeconds <= MAX_AGE_SECONDS &&
    Number.isFinite(o.sigmaDeg) && o.sigmaDeg > 0 && o.sigmaDeg <= 20 &&
    known.has(o.landmarkId)
  );
  const base = { usedObservations: accepted.length, rejectedObservations: scenario.observations.length - accepted.length };
  const hold = (reason: string): NavigationEstimate => ({
    status: 'HOLD', reason, positionKm: null, residualRmsKm: null,
    uncertainty95Km: null, conditionNumber: null, ...base,
  });
  if (accepted.length < 3) return hold('Insufficient fresh, valid optical bearings (minimum three required).');
  // Normal equation for n dot position = n dot landmark, where n is normal
  // to the observed line of sight. No use of simulation ground truth here.
  let xx = 0, xy = 0, yy = 0, bx = 0, by = 0;
  const rows: Array<{ nx: number; ny: number; rhs: number; landmark: Landmark; sigma: number }> = [];
  for (const obs of accepted) {
    const landmark = known.get(obs.landmarkId)!;
    const theta = obs.bearingDeg * RAD;
    const nx = -Math.sin(theta), ny = Math.cos(theta);
    const rhs = nx * landmark.positionKm.x + ny * landmark.positionKm.y;
    xx += nx * nx; xy += nx * ny; yy += ny * ny;
    bx += nx * rhs; by += ny * rhs;
    rows.push({ nx, ny, rhs, landmark, sigma: obs.sigmaDeg * RAD });
  }
  const determinant = xx * yy - xy * xy;
  const trace = xx + yy;
  const spread = Math.hypot(xx - yy, 2 * xy);
  const minEigen = (trace - spread) / 2;
  const maxEigen = (trace + spread) / 2;
  if (determinant <= 1e-10 || minEigen <= 1e-10) {
    return hold('Unobservable geometry: bearing lines do not give a reliable independent position fix.');
  }
  const conditionNumber = Math.sqrt(maxEigen / minEigen);
  if (conditionNumber > MAX_CONDITION) {
    return hold('Ill-conditioned optical geometry: independent viewing directions required.');
  }
  const positionKm = {
    x: (yy * bx - xy * by) / determinant,
    y: (xx * by - xy * bx) / determinant,
  };
  if (!Number.isFinite(positionKm.x) || !Number.isFinite(positionKm.y)) {
    return hold('Non-finite navigation solution.');
  }
  const residualRmsKm = Math.sqrt(rows.reduce((sum, r) => {
    const residual = r.nx * positionKm.x + r.ny * positionKm.y - r.rhs;
    return sum + residual * residual;
  }, 0) / rows.length);
  const maxRangeKm = Math.max(...rows.map(r => Math.hypot(
    positionKm.x - r.landmark.positionKm.x,
    positionKm.y - r.landmark.positionKm.y,
  )));
  const sigmaRad = Math.max(...rows.map(r => r.sigma));
  // Error propagation is approximate: sigma_line = max range * max angular sigma.
  const uncertainty95Km = 2.45 * maxRangeKm * sigmaRad / Math.sqrt(minEigen);
  const rejectionThresholdKm = Math.max(0.6, 3 * maxRangeKm * sigmaRad);
  const reason = residualRmsKm > rejectionThresholdKm
    ? 'Inconsistent optical measurements: cross-track residual exceeds the simulated integrity limit.'
    : uncertainty95Km > MAX_UNCERTAINTY_KM
      ? 'Navigation uncertainty is too high for the simulated advisory gate.'
      : 'Consistent simulated bearing fix. Advisory display only; no actuation permitted.';
  const status = residualRmsKm > rejectionThresholdKm || uncertainty95Km > MAX_UNCERTAINTY_KM
    ? 'HOLD' : 'ADVISORY';
  return { status, reason, positionKm, residualRmsKm, uncertainty95Km, conditionNumber, ...base };
}
