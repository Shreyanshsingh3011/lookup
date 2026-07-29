/**
 * End-to-end check that live Celestrak data works: fetch real elements, parse
 * them, and predict passes from them.
 *
 * Run with `npm run check:live -w server`. The fixture fallback is force-
 * disabled so a network failure surfaces as a failure instead of quietly
 * degrading to bundled 2024-epoch elements.
 */
process.env.ALLOW_TLE_FIXTURE = "0";

const { getTleGroup } = await import("./celestrak.js");
const { computeVisiblePasses } = await import("./passes.js");

const OBSERVER = { latitude: 51.4769, longitude: -0.0005, elevation: 45 }; // Greenwich

function fail(message: string, hint?: string): never {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`\n  ${hint}`);
  process.exit(1);
}

console.log("Fetching the 'stations' group from celestrak.org …");

let result;
try {
  result = await getTleGroup("stations");
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  fail(
    `Could not reach Celestrak: ${message}`,
    "If this is a Claude Code cloud session, the environment's network access level must\n" +
      "  allow celestrak.org. Set Network access to Custom in the environment settings at\n" +
      "  claude.ai/code, add celestrak.org, and tick 'Also include default list of common\n" +
      "  package managers'. The change applies to NEW sessions, not the current one."
  );
}

if (result.source !== "live") {
  fail(`Expected live elements but got source="${result.source}".`);
}

const ageHours = (Date.now() - result.fetchedAt) / 3_600_000;
console.log(`✓ ${result.tles.length} satellites, source=${result.source}, fetched ${ageHours.toFixed(2)}h ago`);

const iss = result.tles.find((t) => t.satnum === "25544");
if (!iss) {
  fail("The ISS (NORAD 25544) was not present in the 'stations' group.");
}

// A real element set's epoch should be within a few days of now; a stale epoch
// is the single biggest source of silently wrong predictions.
const epochYear = 2000 + Number(iss.line1.slice(18, 20));
const epochDay = Number(iss.line1.slice(20, 32));
const epoch = new Date(Date.UTC(epochYear, 0, 1) + (epochDay - 1) * 86_400_000);
const epochAgeDays = (Date.now() - epoch.getTime()) / 86_400_000;

console.log(`✓ ISS epoch ${epoch.toISOString()} (${epochAgeDays.toFixed(2)} days old)`);
if (epochAgeDays > 14 || epochAgeDays < -1) {
  fail(`ISS element epoch is ${epochAgeDays.toFixed(1)} days from now — predictions would be unreliable.`);
}

console.log("\nPredicting visible passes for Greenwich over the next 10 days …");
const passes = computeVisiblePasses(iss, OBSERVER, { days: 10, minElevationDeg: 10 });
console.log(`✓ ${passes.length} visible pass(es)\n`);

for (const p of passes.slice(0, 5)) {
  const start = new Date(p.start.time).toISOString().replace("T", " ").slice(0, 19);
  console.log(
    `  ${start}Z  mag ${String(p.magnitude).padStart(5)}  ` +
      `max ${String(Math.round(p.max.altitudeDeg)).padStart(2)}° ${p.max.direction.padEnd(3)}  ` +
      `${p.start.direction}→${p.end.direction}  ends: ${p.endReason}`
  );
}

console.log("\n✓ Live data path is working end to end.");
