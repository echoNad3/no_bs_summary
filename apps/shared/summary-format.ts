export type SummaryBlock =
  { kind: 'topic'; label: string; body: string } | { kind: 'paragraph'; text: string };
export type SummaryInlinePart = {
  kind: 'text' | 'strong' | 'emphasis';
  text: string;
};

const TOPIC_LINE = /^(?:[-*•]\s+)\*\*([^*]+?)\*\*\s*:?\s*(.*)$/u;
const CURRENT_TOPIC_LINE = /^- \*\*([^*\r\n]+):\*\* ([^\r\n]+)$/u;

export interface CurrentSummaryPoint {
  label: string;
  body: string;
}

export function parseCurrentSummaryPoints(summary: string): CurrentSummaryPoint[] | undefined {
  const sections = summary.trim().split(/\r?\n\s*\r?\n/gu);
  if (sections.length < 1 || sections.length > 3) return undefined;
  const points: CurrentSummaryPoint[] = [];
  for (const section of sections) {
    const match = CURRENT_TOPIC_LINE.exec(section);
    if (!match) return undefined;
    const label = match[1]!.trim();
    const body = match[2]!.trim();
    if (
      !label ||
      !body ||
      countDisplayWords(label) > 8 ||
      /[:*\r\n]|^\s*(?:[-•#]|\d+[.)])/u.test(label) ||
      /\*\*|^\s*(?:[-*•#]|\d+[.)]\s+)/u.test(body)
    ) {
      return undefined;
    }
    points.push({ label, body });
  }
  return points;
}

export function countDisplayWords(text: string): number {
  return text.match(/[\p{L}\p{N}'’-]+/gu)?.length ?? 0;
}

export function parseSummaryBlocks(summary: string): SummaryBlock[] {
  const trimmed = summary.trim();
  if (trimmed === '') return [];

  const blocks: SummaryBlock[] = [];
  let active: SummaryBlock | undefined;
  let pendingParent: string | undefined;
  const flush = () => {
    if (!active) return;
    if (active.kind === 'topic') {
      active.label = active.label.replace(/:\s*$/u, '').trim();
      active.body = active.body.trim();
      if (active.label && active.body) blocks.push(active);
      else if (active.label) pendingParent = active.label;
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
      const nested = /^\s/u.test(rawLine);
      if (!nested) pendingParent = undefined;
      const label = topic[1]!.trim();
      active = {
        kind: 'topic',
        label: nested && pendingParent ? `${pendingParent} — ${label}` : label,
        body: topic[2]!.trim(),
      };
      continue;
    }

    if (!active) {
      if (pendingParent) {
        active = { kind: 'topic', label: pendingParent, body: line };
        pendingParent = undefined;
      } else {
        active = { kind: 'paragraph', text: line };
      }
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
