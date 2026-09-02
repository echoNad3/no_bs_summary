import { parseInlineMarkdown, parseSummaryBlocks } from './summary-format.js';

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
      appendInlineFormatting(item, block.body);
      list.append(item);
      continue;
    }

    list = undefined;
    const paragraph = document.createElement('p');
    appendInlineFormatting(paragraph, block.text);
    element.append(paragraph);
  }
}

function appendInlineFormatting(element: HTMLElement, text: string): void {
  for (const part of parseInlineMarkdown(text)) {
    if (part.kind === 'text') {
      element.append(document.createTextNode(part.text));
      continue;
    }
    const formatted = document.createElement(part.kind === 'strong' ? 'strong' : 'em');
    formatted.textContent = part.text;
    element.append(formatted);
  }
}
