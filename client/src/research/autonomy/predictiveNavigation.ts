/**
 * Deterministic, synthetic 3-D relative-motion research model for Lookup.
 * A calibrated 3-D initial fix and a velocity prior are ASSUMED, not recovered
 * from one monocular image. An optional synthetic multi-view/ranging position
 * update reduces uncertainty. This is NOT real perception, orbital propagation,
 * statistical flight certification, a collision warning or an actuator driver.
 */
export type Vector3 = { x: number; y: number; z: number };
export type Axis = 'x' | 'y' | 'z';

export interface AxisBelief {
  positionKm: number;
  velocityKmPerS: number;
  variancePosition: number;
  covariancePositionVelocity: number;
  varianceVelocity: number;
}
export type TrackBelief = Record<Axis, AxisBelief>;
export interface PredictedState {
  seconds: number;
  positionKm: Vector3;
  velocityKmPerS: Vector3;
  uncertainty95Km: number;
}
export interface PredictionDemo {
  now: PredictedState;
  future: PredictedState;
  history: PredictedState[];
  forecast: PredictedState[];
  truthNowKm: Vector3;
  truthFutureKm: Vector3;
  errorNowKm: number;
  errorFutureKm: number;
  updateAccepted: boolean;
  truthInside95Sphere: boolean;
  modelMismatch: boolean;
}
export interface PredictionOptions {
  horizonSeconds: number;
  followUpObservation: boolean;
  unexpectedManeuver: boolean;
}

export const PRESENT_SECONDS = 45;
export const MAX_HORIZON_SECONDS = 600;
const CHI3_95_SQRT = Math.sqrt(7.814727903);
const ACCELERATION_STD_KM_PER_S2 = 0.0000025;
const TRUTH_P0: Vector3 = { x: 2.5, y: -1.2, z: 0.75 };
const TRUTH_V: Vector3 = { x: 0.003, y: 0.0011, z: -0.0005 };
const UNEXPECTED_ACCELERATION: Vector3 = { x: 0.000028, y: -0.000017, z: 0.000019 };
const MANEUVER_AT_SECONDS = 120;
const AXES: Axis[] = ['x', 'y', 'z'];

function vectorFrom(fn: (axis: Axis) => number): Vector3 {
  return { x: fn('x'), y: fn('y'), z: fn('z') };
}

function separationKm(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Synthetic hidden truth is strictly for demonstrating model mismatch. */
export function syntheticTruth(seconds: number, unexpectedManeuver = false): Vector3 {
  if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Invalid simulated time');
  const maneuverT = unexpectedManeuver ? Math.max(0, seconds - MANEUVER_AT_SECONDS) : 0;
  return vectorFrom(axis =>
    TRUTH_P0[axis] + TRUTH_V[axis] * seconds +
    0.5 * UNEXPECTED_ACCELERATION[axis] * maneuverT * maneuverT,
  );
}

/**
 * A 6-state 3-D position/velocity estimate implemented as three independent
 * 2x2 covariance blocks. It intentionally excludes cross-axis correlations.
 */
export function initialBelief(): TrackBelief {
  const positionErrors: Vector3 = { x: 0.06, y: -0.045, z: 0.035 };
  const velocityErrors: Vector3 = { x: 0.00022, y: -0.00014, z: 0.0001 };
  const initialPositionSigmaKm = 0.12;
  const initialVelocitySigmaKmPerS = 0.0005;
  return {
    x: makeAxis('x'),
    y: makeAxis('y'),
    z: makeAxis('z'),
  };
  function makeAxis(axis: Axis): AxisBelief {
    return {
      positionKm: TRUTH_P0[axis] + positionErrors[axis],
      velocityKmPerS: TRUTH_V[axis] + velocityErrors[axis],
      variancePosition: initialPositionSigmaKm ** 2,
      covariancePositionVelocity: 0,
      varianceVelocity: initialVelocitySigmaKmPerS ** 2,
    };
  }
}

/** Constant-velocity prediction with white-acceleration discrete process noise. */
export function propagateBelief(belief: TrackBelief, dtSeconds: number): TrackBelief {
  if (!Number.isFinite(dtSeconds) || dtSeconds < 0 || dtSeconds > 10000) {
    throw new RangeError('Prediction interval must be between 0 and 10000 seconds');
  }
  const t = dtSeconds;
  const q = ACCELERATION_STD_KM_PER_S2 ** 2;
  return {
    x: step(belief.x),
    y: step(belief.y),
    z: step(belief.z),
  };
  function step(a: AxisBelief): AxisBelief {
    return {
      positionKm: a.positionKm + a.velocityKmPerS * t,
      velocityKmPerS: a.velocityKmPerS,
      variancePosition: a.variancePosition + 2 * t * a.covariancePositionVelocity +
        t * t * a.varianceVelocity + q * t ** 4 / 4,
      covariancePositionVelocity: a.covariancePositionVelocity + t * a.varianceVelocity + q * t ** 3 / 2,
      varianceVelocity: a.varianceVelocity + q * t * t,
    };
  }
}

/** Position-only Kalman update, representing a hypothetical calibrated 3-D fix. */
export function updateWithPosition(
  belief: TrackBelief,
  measuredKm: Vector3,
  measurementStdKm: number,
): { belief: TrackBelief; accepted: boolean } {
  if (!Number.isFinite(measurementStdKm) || measurementStdKm <= 0) {
    throw new RangeError('Measurement standard deviation must be positive');
  }
  const r = measurementStdKm ** 2;
  const normalizedInnovationSquared = AXES.reduce((sum, axis) => {
    const a = belief[axis];
    const value = measuredKm[axis];
    if (!Number.isFinite(value)) return Infinity;
    return sum + ((value - a.positionKm) ** 2 / (a.variancePosition + r));
  }, 0);
  // Deliberately simple research-only 3-D innovation gate.
  if (normalizedInnovationSquared > 16.27) {
    return { belief, accepted: false };
  }
  const next = { ...belief };
  for (const axis of AXES) {
    const a = belief[axis];
    const innovation = measuredKm[axis] - a.positionKm;
    const denominator = a.variancePosition + r;
    const kp = a.variancePosition / denominator;
    const kv = a.covariancePositionVelocity / denominator;
    next[axis] = {
      positionKm: a.positionKm + kp * innovation,
      velocityKmPerS: a.velocityKmPerS + kv * innovation,
      variancePosition: Math.max(0, a.variancePosition * (1 - kp)),
      covariancePositionVelocity: a.covariancePositionVelocity * (1 - kp),
      varianceVelocity: Math.max(0, a.varianceVelocity - kv * a.covariancePositionVelocity),
    };
  }
  return { belief: next, accepted: true };
}

/**
 * Illustrative spherical envelope using the largest axis variance and the
 * chi-square radius for three independent Gaussian position components.
 * It is NOT a demonstrated 95% coverage claim for a real navigation system.
 */
export function stateAt(belief: TrackBelief, seconds: number): PredictedState {
  const maxPositionVariance = Math.max(...AXES.map(a => belief[a].variancePosition));
  return {
    seconds,
    positionKm: vectorFrom(axis => belief[axis].positionKm),
    velocityKmPerS: vectorFrom(axis => belief[axis].velocityKmPerS),
    uncertainty95Km: CHI3_95_SQRT * Math.sqrt(Math.max(0, maxPositionVariance)),
  };
}

export function simulatePrediction(options: PredictionOptions): PredictionDemo {
  const { horizonSeconds, followUpObservation, unexpectedManeuver } = options;
  if (!Number.isFinite(horizonSeconds) || horizonSeconds < 0 || horizonSeconds > MAX_HORIZON_SECONDS) {
    throw new RangeError('Horizon must be between 0 and 600 seconds');
  }
  const initial = initialBelief();
  const justBeforeUpdate = propagateBelief(initial, PRESENT_SECONDS);
  const measuredKm = vectorFrom(axis => syntheticTruth(PRESENT_SECONDS)[axis] + ({
    x: 0.018, y: -0.015, z: 0.013,
  } as Vector3)[axis]);
  const corrected = followUpObservation
    ? updateWithPosition(justBeforeUpdate, measuredKm, 0.03)
    : { belief: justBeforeUpdate, accepted: false };
  const now = stateAt(corrected.belief, PRESENT_SECONDS);
  const futureBelief = propagateBelief(corrected.belief, horizonSeconds);
  const future = stateAt(futureBelief, PRESENT_SECONDS + horizonSeconds);

  const history = [0, 15, 30, PRESENT_SECONDS].map(time =>
    stateAt(propagateBelief(initial, time), time));
  if (corrected.accepted) history[history.length - 1] = now;
  const times = [...new Set([
    PRESENT_SECONDS, ...Array.from({ length: 20 }, (_, i) => PRESENT_SECONDS + (i + 1) * 30),
    PRESENT_SECONDS + horizonSeconds,
  ])].sort((a, b) => a - b);
  const forecast = times.map(t => stateAt(propagateBelief(corrected.belief, t - PRESENT_SECONDS), t));
  const truthNowKm = syntheticTruth(PRESENT_SECONDS, unexpectedManeuver);
  const truthFutureKm = syntheticTruth(future.seconds, unexpectedManeuver);
  const errorNowKm = separationKm(now.positionKm, truthNowKm);
  const errorFutureKm = separationKm(future.positionKm, truthFutureKm);
  return {
    now, future, history, forecast, truthNowKm, truthFutureKm, errorNowKm,
    errorFutureKm, updateAccepted: corrected.accepted,
    truthInside95Sphere: errorFutureKm <= future.uncertainty95Km,
    modelMismatch: unexpectedManeuver && future.seconds > MANEUVER_AT_SECONDS,
  };
}
