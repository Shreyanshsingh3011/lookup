// Vercel serverless function entry. The catch-all filename is what maps
// every /api/* request to this one function without needing a vercel.json
// rewrite — Express then does its own routing from the real request path.
//
// Deliberately hand-written and NOT compiled by tsc: it only re-exports the
// already-built app from dist/index.js (produced by the normal `npm run
// build`), so the local dev/build/start scripts stay untouched.
import app from "../dist/index.js";

export default app;
