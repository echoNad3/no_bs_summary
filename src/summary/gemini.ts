import type { Summary, SummaryProvider } from './provider.js';

/**
 * Gemini adapter (implemented in Phase 3).
 *
 * Confirmed details:
 * - SDK: @google/genai (Interactions API available from v2.3.0)
 * - Method: ai.interactions.create
 * - Model: gemini-3.1-flash-lite (GA; 1,048,576 input / 65,536 output tokens),
 *   overridable via GEMINI_MODEL
 * - Confirmed against installed @google/genai 2.11.0 types (all snake_case):
 *   ai.interactions.create({ model, input, store: false, system_instruction,
 *     generation_config: { thinking_level: 'minimal', temperature },
 *     response_format: { type: 'text', mime_type: 'application/json', schema } })
 *   → interaction.output_text (string | undefined)
 */
export class GeminiSummaryProvider implements SummaryProvider {
  readonly name = 'gemini';

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async summarize(_transcriptText: string, _signal: AbortSignal): Promise<Summary> {
    throw new Error('GeminiSummaryProvider is not implemented yet (Phase 3).');
  }
}
