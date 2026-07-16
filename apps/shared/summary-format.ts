export type SummaryBlock =
  { kind: 'topic'; label: string; body: string } | { kind: 'paragraph'; text: string };

const TOPIC_LINE = /^-\s+\*\*(.+?):\*\*\s*(.+)$/u;

export function parseSummaryBlocks(summary: string): SummaryBlock[] {
  const trimmed = summary.trim();
  if (trimmed === '') return [];

  const lines = trimmed
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean);
  const topics = lines.map((line) => TOPIC_LINE.exec(line));
  if (topics.length > 0 && topics.every((topic) => topic !== null)) {
    return topics.map((topic) => ({
      kind: 'topic',
      label: topic![1]!.trim(),
      body: topic![2]!.trim(),
    }));
  }

  return trimmed
    .split(/\r?\n\s*\r?\n/gu)
    .map((text) => text.replace(/\s*\r?\n\s*/gu, ' ').trim())
    .filter(Boolean)
    .map((text) => ({ kind: 'paragraph', text }));
}
