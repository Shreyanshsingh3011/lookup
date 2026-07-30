import type { Request, Response, NextFunction } from "express";

/**
 * Minimal per-IP sliding-window rate limiter for the AI-backed routes.
 *
 * Unlike the rest of this API, a request here can cost real money (an LLM
 * call), so unlike everything else in this server, "just let it through and
 * degrade gracefully" isn't the right default — an unbounded client (or a
 * script) hammering the button burns API credit with no ceiling. This is
 * deliberately simple: in-memory, per-process, good enough for a single
 * server instance. A multi-instance deployment would need a shared store.
 */
export function rateLimit(opts: { windowMs: number; max: number }) {
  const hits = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const windowStart = now - opts.windowMs;

    const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);
    if (recent.length >= opts.max) {
      res.status(429).json({
        error: `Too many requests. Limit is ${opts.max} per ${Math.round(opts.windowMs / 1000)}s.`,
      });
      return;
    }

    recent.push(now);
    hits.set(key, recent);

    // Periodic sweep so the map doesn't grow unbounded across many distinct
    // IPs over a long-running process.
    if (hits.size > 1000) {
      for (const [k, times] of hits) {
        if (times.every((t) => t <= windowStart)) hits.delete(k);
      }
    }

    next();
  };
}
