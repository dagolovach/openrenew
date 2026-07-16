// lib/ai.ts
// AI features (extraction, analysis, comparison, drafting) are optional in the
// self-hosted edition. They require ANTHROPIC_API_KEY to be set on the Python
// service's environment; the Next.js app reads its own copy of the same var
// to decide whether to trigger AI work or render the app as a manual tracker.
export function aiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
