/**
 * End-to-end check that the live Claude orbit-advice path works.
 *
 * Run with `npm run check:orbit-advice -w server` after setting ANTHROPIC_API_KEY.
 * Without a key, adviseOnOrbit silently takes the template path — which is
 * correct production behaviour, but means a broken key or a broken prompt
 * would never surface on its own. This script fails loudly instead.
 */
import { adviseOnOrbit } from "./orbitAdvice.js";
import { aiAvailable } from "./ai.js";

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

if (!aiAvailable()) {
  fail(
    "ANTHROPIC_API_KEY is not set, so there is nothing to check — this script only verifies the\n" +
      "  live AI path. Set the key and rerun: ANTHROPIC_API_KEY=sk-... npm run check:orbit-advice -w server"
  );
}

console.log("Asking Claude for orbit advice on a sample mission …\n");

const request = {
  missionType: "earth-observation" as const,
  missionGoal: "Monitor crop health over a specific region on a weekly cadence.",
  launchSiteLatitudeDeg: 28.5,
  timingNotes: "Would like to launch within the next year.",
};

const result = await adviseOnOrbit(request);
console.log(`source=${result.source}`);
console.log(`  ${result.advice}\n`);

if (result.source !== "ai") {
  fail("The request fell back to the template path despite a key being set — check the warning logged above for the real error.");
}
if (/\$\d/.test(result.advice)) {
  fail("The response contains what looks like a dollar figure — the system prompt should forbid fabricated pricing.");
}

console.log("✓ Live Claude orbit-advice path is working end to end.");
