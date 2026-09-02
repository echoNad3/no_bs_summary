export type SummaryBlock =
  { kind: 'topic'; label: string; body: string } | { kind: 'paragraph'; text: string };
export type SummaryInlinePart = {
  kind: 'text' | 'strong' | 'emphasis';
  text: string;
};

const TOPIC_LINE = /^(?:[-*•]\s+)\*\*([^*]+?)\*\*\s*:?\s*(.*)$/u;

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
    const line = rawLine.trim();
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

export function parseInlineMarkdown(text: string): SummaryInlinePart[] {
  const parts: SummaryInlinePart[] = [];
  let plainText = '';
  let cursor = 0;

  const flushPlainText = () => {
    if (plainText === '') return;
    appendPart(parts, 'text', plainText);
    plainText = '';
  };

  while (cursor < text.length) {
    if (text[cursor] === '\\' && (text[cursor + 1] === '*' || text[cursor + 1] === '\\')) {
      plainText += text[cursor + 1];
      cursor += 2;
      continue;
    }

    const marker = text.startsWith('**', cursor) ? '**' : text[cursor] === '*' ? '*' : undefined;
    if (!marker) {
      plainText += text[cursor];
      cursor += 1;
      continue;
    }

    const contentStart = cursor + marker.length;
    const closing = isNonWhitespace(text[contentStart])
      ? findClosingMarker(text, contentStart, marker)
      : -1;
    if (closing >= 0) {
      flushPlainText();
      appendPart(
        parts,
        marker === '**' ? 'strong' : 'emphasis',
        unescapeInlineText(text.slice(contentStart, closing)),
      );
      cursor = closing + marker.length;
      continue;
    }

    if (marker === '*' && isLiteralAsterisk(text, cursor)) plainText += '*';
    cursor += marker.length;
  }
  flushPlainText();
  return parts;
}

function joinLine(current: string, next: string): string {
  return current ? `${current} ${next}` : next;
}

function findClosingMarker(text: string, start: number, marker: '*' | '**'): number {
  for (let cursor = start; cursor <= text.length - marker.length; cursor += 1) {
    if (text[cursor] === '\n' || text[cursor] === '\r') return -1;
    if (text[cursor] === '\\') {
      cursor += 1;
      continue;
    }
    if (!text.startsWith(marker, cursor) || !isNonWhitespace(text[cursor - 1])) continue;
    if (marker === '*' && (text[cursor - 1] === '*' || text[cursor + 1] === '*')) continue;
    return cursor;
  }
  return -1;
}

function appendPart(
  parts: SummaryInlinePart[],
  kind: SummaryInlinePart['kind'],
  text: string,
): void {
  if (text === '') return;
  const previous = parts.at(-1);
  if (previous?.kind === kind) previous.text += text;
  else parts.push({ kind, text });
}

function unescapeInlineText(text: string): string {
  return text.replace(/\\([*\\])/gu, '$1');
}

function isNonWhitespace(character: string | undefined): boolean {
  return character !== undefined && !/\s/u.test(character);
}

function isLiteralAsterisk(text: string, cursor: number): boolean {
  const before = text[cursor - 1];
  const after = text[cursor + 1];
  return (
    (!isNonWhitespace(before) && !isNonWhitespace(after)) ||
    (/\d/u.test(before ?? '') && /\d/u.test(after ?? ''))
  );
}
