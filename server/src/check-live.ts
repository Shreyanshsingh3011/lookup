/**
 * End-to-end check that real element data works: load it, parse it, and predict
 * passes from it.
 *
 * Run with `npm run check:live -w server`. Normally this verifies the live
 * Celestrak path; if TLE_FILE is set, the intent is clearly to validate those
 * elements instead, so `source: "file"` is accepted too. Either way the fixture
 * fallback is force-disabled, so a failure surfaces rather than quietly
 * degrading to bundled 2024-epoch elements.
 */
process.env.ALLOW_TLE_FIXTURE = "0";

const { getTleGroup } = await import("./celestrak.js");
const { computeVisiblePasses } = await import("./passes.js");
const { elementFilePath } = await import("./elements.js");

const OBSERVER = { latitude: 51.4769, longitude: -0.0005, elevation: 45 }; // Greenwich

function fail(message: string, hint?: string): never {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`\n  ${hint}`);
  process.exit(1);
}

const fromFile = elementFilePath();
console.log(
  fromFile
    ? `Loading the 'stations' group from TLE_FILE (${fromFile}) …`
    : "Fetching the 'stations' group from celestrak.org …"
);

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

const acceptable = fromFile ? ["file"] : ["live"];
if (!acceptable.includes(result.source)) {
  fail(
    `Expected source="${acceptable[0]}" but got source="${result.source}".`,
    result.source === "cache"
      ? "Celestrak was unreachable and a stale cache entry was served."
      : undefined
  );
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
const { passes, tooFaintCount, brightestRejectedMagnitude } = computeVisiblePasses(iss, OBSERVER, {
  days: 10,
  minElevationDeg: 10,
});
console.log(`✓ ${passes.length} visible pass(es)`);
if (tooFaintCount > 0) {
  console.log(
    `  (${tooFaintCount} further pass(es) were geometrically valid but too faint to see; ` +
      `brightest was magnitude ${brightestRejectedMagnitude})`
  );
}
console.log();

for (const p of passes.slice(0, 5)) {
  const start = new Date(p.start.time).toISOString().replace("T", " ").slice(0, 19);
  console.log(
    `  ${start}Z  mag ${String(p.magnitude).padStart(5)}  ` +
      `max ${String(Math.round(p.max.altitudeDeg)).padStart(2)}° ${p.max.direction.padEnd(3)}  ` +
      `${p.start.direction}→${p.end.direction}  ends: ${p.endReason}`
  );
}

console.log(`\n✓ ${fromFile ? "Operator-supplied" : "Live"} element path is working end to end.`);
