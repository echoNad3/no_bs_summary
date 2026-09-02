import type { SummaryResult } from './api-client.js';
import { parseSummaryBlocks, stripInlineMarkdown } from './summary-format.js';

export function summaryClipboardText(
  response: SummaryResult,
  context: { title?: string; url?: string } = {},
): string {
  const detail = parseSummaryBlocks(response.summary)
    .map((block) =>
      stripInlineMarkdown(block.kind === 'topic' ? `${block.label}: ${block.body}` : block.text),
    )
    .join('\n\n');
  const heading = context.title?.trim();
  const source = context.url?.trim();

  return [
    heading,
    `${response.verdict}: ${response.reason}`,
    detail,
    source,
    'Summarized with No BS Summary',
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
}
