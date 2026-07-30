/**
 * End-to-end check that the live Claude explanation path works.
 *
 * Run with `npm run check:explain -w server` after setting ANTHROPIC_API_KEY.
 * Without a key, explainObject silently takes the template path — which is
 * correct production behaviour, but means a broken key or a broken prompt
 * would never surface on its own. This script fails loudly instead.
 */
import { explainObject } from "./explain.js";
import { aiAvailable } from "./ai.js";

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

if (!aiAvailable()) {
  fail(
    "ANTHROPIC_API_KEY is not set, so there is nothing to check — this script only verifies the\n" +
      "  live AI path. Set the key and rerun: ANTHROPIC_API_KEY=sk-... npm run check:explain -w server"
  );
}

console.log("Asking Claude to explain a sample satellite, planet, and star …\n");

const subjects = [
  {
    kind: "satellite" as const,
    name: "ISS (ZARYA)",
    altitudeKm: 422,
    speedKmS: 7.66,
    elevationDeg: 45.3,
    azimuthDeg: 210.5,
    direction: "SSW",
    illuminated: true,
    nextPassTime: new Date(Date.now() + 3600_000).toISOString(),
  },
  {
    kind: "planet" as const,
    name: "Moon",
    elevationDeg: 30.2,
    azimuthDeg: 90,
    direction: "E",
    magnitude: -12.3,
    illuminatedFraction: 0.72,
  },
  {
    kind: "star" as const,
    name: "Vega",
    elevationDeg: 60.1,
    azimuthDeg: 45.0,
    direction: "NE",
    magnitude: 0.03,
    constellation: "Lyra",
  },
];

let anyFellBackToTemplate = false;

for (const subject of subjects) {
  const result = await explainObject(subject);
  console.log(`[${subject.kind}] ${subject.name} — source=${result.source}`);
  console.log(`  ${result.explanation}\n`);
  if (result.source !== "ai") anyFellBackToTemplate = true;
}

if (anyFellBackToTemplate) {
  fail("At least one request fell back to the template path despite a key being set — check the warning logged above for the real error.");
}

console.log("✓ Live Claude explanation path is working end to end.");
