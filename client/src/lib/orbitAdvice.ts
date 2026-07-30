/**
 * Client-side mirror of the server's orbit-advice contract
 * (server/src/orbitAdvice.ts). Kept in sync by hand, same as lib/explain.ts.
 */
export const MISSION_TYPES = [
  'earth-observation',
  'communications',
  'navigation',
  'technology-demo',
  'human-spaceflight',
  'scientific-research',
  'deep-space',
] as const;

export type MissionType = (typeof MISSION_TYPES)[number];

export const MISSION_TYPE_LABELS: Record<MissionType, string> = {
  'earth-observation': 'Earth observation',
  communications: 'Communications',
  navigation: 'Navigation',
  'technology-demo': 'Technology demo',
  'human-spaceflight': 'Human spaceflight',
  'scientific-research': 'Scientific research',
  'deep-space': 'Deep space',
};

export interface OrbitAdviceRequest {
  missionType: MissionType;
  missionGoal: string;
  launchSiteLatitudeDeg: number;
  timingNotes: string | null;
}

export interface OrbitAdviceResult {
  advice: string;
  source: 'ai' | 'template';
}
