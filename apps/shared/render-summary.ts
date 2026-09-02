import { parseSummaryBlocks } from './summary-format.js';

export function renderDetailedSummary(element: HTMLElement, summary: string): void {
  const blocks = parseSummaryBlocks(summary);
  element.replaceChildren();

  let list: HTMLUListElement | undefined;
  for (const block of blocks) {
    if (block.kind === 'topic') {
      if (!list) {
        list = document.createElement('ul');
        list.className = 'summary-topics';
        element.append(list);
      }
      const item = document.createElement('li');
      const label = document.createElement('strong');
      label.textContent = `${block.label}: `;
      item.append(label);
      appendInlineStrong(item, block.body);
      list.append(item);
      continue;
    }

    list = undefined;
    const paragraph = document.createElement('p');
    appendInlineStrong(paragraph, block.text);
    element.append(paragraph);
  }
}

function appendInlineStrong(element: HTMLElement, text: string): void {
  const normalized = text.replace(/\\\*/gu, '*');
  let cursor = 0;
  for (const match of normalized.matchAll(/\*\*([^*\r\n]+?)\*\*/gu)) {
    const index = match.index ?? 0;
    if (index > cursor) appendPlainText(element, normalized.slice(cursor, index));
    const strong = document.createElement('strong');
    strong.textContent = match[1]!.trim();
    element.append(strong);
    cursor = index + match[0].length;
  }
  if (cursor < normalized.length) {
    appendPlainText(element, normalized.slice(cursor));
  }
}

function appendPlainText(element: HTMLElement, text: string): void {
  element.append(document.createTextNode(text.replace(/\*\*/gu, '')));
}
