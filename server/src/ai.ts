import Anthropic from "@anthropic-ai/sdk";

/**
 * Shared Claude client for AI-assisted features (object identification, the
 * orbit advisor). Every caller in this file follows the same rule: AI output
 * is either grounded in facts the caller supplies, or explicitly scoped to
 * well-established physics/astronomy the model can be trusted on — never
 * asked to invent a number (a price, a date, a specific orbital element) that
 * nobody gave it and that isn't public, stable knowledge.
 *
 * Every feature built on this must degrade to a non-AI fallback when no key is
 * configured or the call fails. AI is a phrasing/explanation layer here, never
 * the sole source of a fact the UI presents as true.
 */

const MODEL = "claude-sonnet-5";
const REQUEST_TIMEOUT_MS = 12_000;

let client: Anthropic | null | undefined; // undefined = not yet checked

function getClient(): Anthropic | null {
  if (client !== undefined) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  client = apiKey ? new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS }) : null;
  return client;
}

export function aiAvailable(): boolean {
  return getClient() !== null;
}

export interface GroundedPromptOptions {
  system: string;
  user: string;
  maxTokens?: number;
}

/**
 * Ask Claude a single grounded question. Returns null (never throws) when no
 * key is configured, the call fails, or times out — callers must have a
 * non-AI fallback ready, not treat null as exceptional.
 */
export async function askGrounded(opts: GroundedPromptOptions): Promise<string | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 300,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    });
    const text = response.content.find((block) => block.type === "text");
    return text && "text" in text ? text.text.trim() : null;
  } catch (err) {
    console.warn(`[ai] request failed, falling back: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
