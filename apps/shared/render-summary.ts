import { parseSummaryBlocks } from './summary-format.js';

export function renderDetailedSummary(element: HTMLElement, summary: string): void {
  const blocks = parseSummaryBlocks(summary);
  element.replaceChildren();

  if (blocks.length > 0 && blocks.every((block) => block.kind === 'topic')) {
    const list = document.createElement('ul');
    list.className = 'summary-topics';
    for (const block of blocks) {
      if (block.kind !== 'topic') continue;
      const item = document.createElement('li');
      const label = document.createElement('strong');
      label.textContent = `${block.label}: `;
      item.append(label, document.createTextNode(block.body));
      list.append(item);
    }
    element.append(list);
    return;
  }

  for (const block of blocks) {
    const paragraph = document.createElement('p');
    paragraph.textContent =
      block.kind === 'paragraph' ? block.text : `${block.label}: ${block.body}`;
    element.append(paragraph);
  }
}
