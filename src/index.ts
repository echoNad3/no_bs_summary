/**
 * Benchmark entry point.
 *
 * Phase 1: scaffold only — the real pipeline arrives in Phase 2 (transcripts)
 * and Phase 3 (Gemini summaries + full end-to-end benchmark).
 *
 * Planned flags:
 *   --no-cache     force live transcript requests
 *   --clear-cache  delete the local transcript cache and exit
 */
function main(): void {
  console.log('no-bullshit-summary benchmark: scaffold only (Phase 1).');
  console.log('Transcript benchmarking arrives in Phase 2, Gemini summaries in Phase 3.');
}

main();
