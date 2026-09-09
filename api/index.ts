// Vercel's entry point for the whole API — every request under /api/* is
// routed here by the rewrite in vercel.json, and this file just hands the
// real Express app off. Deliberately a one-line adapter, not a copy: the
// actual routes/logic all live in server/index.ts (Irfan-owned), which stays
// the single source of truth for both `npm run dev:api` (real Node server)
// and this (Vercel Node.js serverless function). See its own header comment
// for why app.listen() is guarded rather than removed.

export { default } from '../server/index.js';
