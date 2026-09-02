export type SummaryBlock =
  { kind: 'topic'; label: string; body: string } | { kind: 'paragraph'; text: string };

const TOPIC_LINE = /^(?:[-*•]\s+)\*\*([^*]+?)\*\*\s*:?\s*(.*)$/u;
const STRONG_MARKUP = /\*\*([^*\r\n]+?)\*\*/gu;

export function parseSummaryBlocks(summary: string): SummaryBlock[] {
  const trimmed = summary.trim();
  if (trimmed === '') return [];

  const blocks: SummaryBlock[] = [];
  let active: SummaryBlock | undefined;
  const flush = () => {
    if (!active) return;
    if (active.kind === 'topic') {
      active.label = active.label.replace(/:\s*$/u, '').trim();
      active.body = active.body.trim();
      if (active.label) blocks.push(active);
    } else {
      active.text = active.text.trim();
      if (active.text) blocks.push(active);
    }
    active = undefined;
  };

  for (const rawLine of trimmed.split(/\r?\n/gu)) {
    const line = normalizeMarkdown(rawLine.trim());
    if (line === '') {
      flush();
      continue;
    }

    const topic = TOPIC_LINE.exec(line);
    if (topic) {
      flush();
      active = {
        kind: 'topic',
        label: topic[1]!.trim(),
        body: topic[2]!.trim(),
      };
      continue;
    }

    if (!active) {
      active = { kind: 'paragraph', text: line };
    } else if (active.kind === 'topic') {
      active.body = joinLine(active.body, line);
    } else {
      active.text = joinLine(active.text, line);
    }
  }
  flush();

  return blocks;
}

export function stripStrongMarkdown(text: string): string {
  return normalizeMarkdown(text).replace(STRONG_MARKUP, '$1').replace(/\*\*/gu, '');
}

function normalizeMarkdown(text: string): string {
  return text.replace(/\\\*/gu, '*');
}

function joinLine(current: string, next: string): string {
  return current ? `${current} ${next}` : next;
}
