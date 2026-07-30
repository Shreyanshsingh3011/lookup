import { askGrounded } from "./ai.js";

/**
 * "What am I looking at?" — explains whichever object the user has centred
 * in the sky dome, in plain language.
 *
 * The AI's job is narrow: phrase the facts we hand it, plus well-established
 * general knowledge, into something readable. It never receives permission to
 * invent a number — every figure in the prompt comes from our own SGP4/
 * astronomy-engine computation, and the system prompt tells it explicitly not
 * to state any figure we didn't supply. The template fallback (no API key, or
 * the call fails) is not a degraded experience; it's a fully-formed answer
 * built from the same facts, so the feature never goes "half broken".
 */

export type ExplainSubject =
  | {
      kind: "satellite";
      name: string;
      altitudeKm: number;
      speedKmS: number;
      elevationDeg: number;
      azimuthDeg: number;
      direction: string;
      illuminated: boolean;
      nextPassTime: string | null;
    }
  | {
      kind: "planet";
      name: string;
      elevationDeg: number;
      azimuthDeg: number;
      direction: string;
      magnitude: number | null;
      illuminatedFraction: number | null; // Moon phase, 0-1
    }
  | {
      kind: "star";
      name: string;
      magnitude: number;
      elevationDeg: number;
      azimuthDeg: number;
      direction: string;
      constellation: string | null;
    }
  | {
      kind: "aircraft";
      name: string;
      elevationDeg: number;
      azimuthDeg: number;
      direction: string;
      altitudeM: number;
      rangeKm: number;
      originCountry: string | null;
      groundSpeedKmH: number | null;
    };

export interface ExplainResult {
  explanation: string;
  source: "ai" | "template";
}

function fmt(n: number, digits = 0): string {
  return n.toFixed(digits);
}

function templateFor(subject: ExplainSubject): string {
  switch (subject.kind) {
    case "satellite": {
      const speedKmh = Math.round(subject.speedKmS * 3600);
      const sentences = [
        `${subject.name} is ${fmt(subject.elevationDeg)}° above your ${subject.direction} horizon right now, ` +
          `orbiting at ${fmt(subject.altitudeKm)} km and moving at ${fmt(subject.speedKmS, 1)} km/s ` +
          `(about ${speedKmh.toLocaleString()} km/h) — fast enough to cross your whole sky in a few minutes.`,
        subject.illuminated
          ? "It's currently sunlit, which is why it's visible as a steady, unblinking point of light — unlike an aircraft, it won't flash or change color."
          : "It's currently in Earth's shadow, so even in a dark sky you wouldn't be able to see it right now.",
      ];
      if (subject.nextPassTime) {
        const when = new Date(subject.nextPassTime).toLocaleString(undefined, {
          weekday: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
        sentences.push(`Its next viewing opportunity from here starts around ${when}.`);
      }
      return sentences.join(" ");
    }
    case "planet": {
      const sentences = [
        `${subject.name} is ${fmt(subject.elevationDeg)}° above your ${subject.direction} horizon.`,
      ];
      if (subject.magnitude !== null) {
        sentences.push(
          `At magnitude ${fmt(subject.magnitude, 1)}, it's ${subject.magnitude < 0 ? "one of the brighter objects" : "a modest point of light"} in tonight's sky.`
        );
      }
      if (subject.illuminatedFraction !== null) {
        sentences.push(`It's currently about ${Math.round(subject.illuminatedFraction * 100)}% illuminated.`);
      }
      sentences.push("Unlike a star, planets shine with a steady, non-twinkling light because they show a tiny disc rather than a true point source.");
      return sentences.join(" ");
    }
    case "aircraft": {
      const sentences = [
        `${subject.name} is an aircraft ${fmt(subject.elevationDeg)}° above your ${subject.direction} horizon, ` +
          `flying at ${Math.round(subject.altitudeM).toLocaleString()} m and currently about ` +
          `${fmt(subject.rangeKm)} km away from you.`,
      ];
      if (subject.groundSpeedKmH !== null) {
        sentences.push(`It's moving at roughly ${Math.round(subject.groundSpeedKmH).toLocaleString()} km/h over the ground.`);
      }
      sentences.push(
        "Aircraft are the usual explanation for a moving light that blinks: they carry flashing " +
          "anti-collision strobes and coloured navigation lights, which is what tells them apart from a " +
          "satellite's steady, unblinking glide."
      );
      return sentences.join(" ");
    }
    case "star": {
      const sentences = [
        `${subject.name} is a magnitude ${fmt(subject.magnitude, 1)} star, ${fmt(subject.elevationDeg)}° above your ${subject.direction} horizon` +
          (subject.constellation ? ` in ${subject.constellation}.` : "."),
      ];
      sentences.push(
        subject.magnitude < 1
          ? "That makes it one of the brightest stars visible from Earth."
          : "It's bright enough to be a useful naked-eye landmark on a clear night."
      );
      return sentences.join(" ");
    }
  }
}

function systemPromptFor(subject: ExplainSubject): string {
  return [
    "You explain night-sky objects to someone using a stargazing app, in 2-4 short sentences of plain text.",
    "No markdown, no headings, no bullet points — just prose, as if speaking to someone standing outside looking up.",
    "You are given a set of measured facts about the object below. Use ONLY those numbers — do not state any",
    "distance, speed, magnitude, size, or time that isn't given to you. You may add well-established general",
    "astronomy or spaceflight knowledge (e.g. why satellites don't blink, what a magnitude scale means, what a",
    "space station is) as long as it doesn't require a number you weren't given. If you're not confident a general",
    "fact is well-established and stable, leave it out rather than guess.",
    "",
    `Facts:\n${JSON.stringify(subject, null, 2)}`,
  ].join("\n");
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNullableFiniteNumber(v: unknown): v is number | null {
  return v === null || isFiniteNumber(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isNullableString(v: unknown): v is string | null {
  return v === null || isNonEmptyString(v);
}

/**
 * Validate an untrusted request body into an ExplainSubject, or null if it
 * doesn't match any known shape. Hand-rolled rather than a schema library,
 * consistent with the rest of this server's request parsing.
 */
export function parseExplainSubject(body: unknown): ExplainSubject | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.name) || !isFiniteNumber(b.elevationDeg) || !isFiniteNumber(b.azimuthDeg) || !isNonEmptyString(b.direction)) {
    return null;
  }

  switch (b.kind) {
    case "satellite":
      if (
        isFiniteNumber(b.altitudeKm) &&
        isFiniteNumber(b.speedKmS) &&
        typeof b.illuminated === "boolean" &&
        isNullableString(b.nextPassTime)
      ) {
        return {
          kind: "satellite",
          name: b.name,
          elevationDeg: b.elevationDeg,
          azimuthDeg: b.azimuthDeg,
          direction: b.direction,
          altitudeKm: b.altitudeKm,
          speedKmS: b.speedKmS,
          illuminated: b.illuminated,
          nextPassTime: b.nextPassTime,
        };
      }
      return null;

    case "planet":
      if (isNullableFiniteNumber(b.magnitude) && isNullableFiniteNumber(b.illuminatedFraction)) {
        return {
          kind: "planet",
          name: b.name,
          elevationDeg: b.elevationDeg,
          azimuthDeg: b.azimuthDeg,
          direction: b.direction,
          magnitude: b.magnitude,
          illuminatedFraction: b.illuminatedFraction,
        };
      }
      return null;

    case "aircraft":
      if (
        isFiniteNumber(b.altitudeM) &&
        isFiniteNumber(b.rangeKm) &&
        isNullableString(b.originCountry) &&
        isNullableFiniteNumber(b.groundSpeedKmH)
      ) {
        return {
          kind: "aircraft",
          name: b.name,
          elevationDeg: b.elevationDeg,
          azimuthDeg: b.azimuthDeg,
          direction: b.direction,
          altitudeM: b.altitudeM,
          rangeKm: b.rangeKm,
          originCountry: b.originCountry,
          groundSpeedKmH: b.groundSpeedKmH,
        };
      }
      return null;

    case "star":
      if (isFiniteNumber(b.magnitude) && isNullableString(b.constellation)) {
        return {
          kind: "star",
          name: b.name,
          elevationDeg: b.elevationDeg,
          azimuthDeg: b.azimuthDeg,
          direction: b.direction,
          magnitude: b.magnitude,
          constellation: b.constellation,
        };
      }
      return null;

    default:
      return null;
  }
}

export async function explainObject(subject: ExplainSubject): Promise<ExplainResult> {
  const ai = await askGrounded({
    system: systemPromptFor(subject),
    user: `What am I looking at? Explain ${subject.name} using the facts you were given.`,
    maxTokens: 220,
  });

  if (ai) return { explanation: ai, source: "ai" };
  return { explanation: templateFor(subject), source: "template" };
}
