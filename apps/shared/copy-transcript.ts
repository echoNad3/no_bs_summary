import { fetchRawTranscript } from './api-client.js';
import { videoIdFrom } from './youtube-input.js';

export function bindCopyTranscript(
  apiBase: string,
  url: HTMLInputElement,
  password: HTMLInputElement,
): () => void {
  const button = document.querySelector<HTMLButtonElement>('#copy-transcript')!;
  const status = document.querySelector<HTMLElement>('#transcript-status')!;
  const fallback = document.querySelector<HTMLTextAreaElement>('#transcript-text')!;
  let cached: { id: string; text: string } | undefined;
  let active: AbortController | undefined;

  button.addEventListener('click', async () => {
    const id = videoIdFrom(url.value);
    if (!id) {
      status.textContent = 'Enter a valid YouTube link.';
      url.focus();
      return;
    }
    button.disabled = true;
    const request = new AbortController();
    active = request;
    fallback.hidden = true;
    status.textContent = 'Loading transcript…';
    const result = (
      cached?.id === id
        ? Promise.resolve(cached.text)
        : fetchRawTranscript(apiBase, id, {
            password: password.value.trim(),
            signal: request.signal,
          })
    ).then((text) => {
      request.signal.throwIfAborted();
      if (videoIdFrom(url.value) !== id) throw new Error('The video changed. Try again.');
      cached = { id, text };
      return text;
    });
    try {
      // Start the write during the click, even if the caption request is pending.
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        const blob = result.then((text) => new Blob([text], { type: 'text/plain' }));
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
        await result;
      } else {
        await navigator.clipboard.writeText(await result);
      }
      if (!request.signal.aborted) status.textContent = 'Transcript copied.';
    } catch {
      try {
        const text = await result;
        if (request.signal.aborted) return;
        if (videoIdFrom(url.value) !== id) throw new Error('The video changed. Try again.');
        fallback.value = text;
        fallback.hidden = false;
        fallback.focus();
        fallback.select();
        status.textContent = 'Copy the selected transcript.';
      } catch (error) {
        if (!request.signal.aborted)
          status.textContent =
            error instanceof Error ? error.message : 'Could not load the transcript.';
      }
    } finally {
      if (active === request) {
        active = undefined;
        button.disabled = false;
      }
    }
  });
  const reset = () => {
    active?.abort();
    active = undefined;
    button.disabled = false;
    fallback.hidden = true;
    fallback.value = '';
    status.textContent = '';
  };
  url.addEventListener('input', reset);
  return reset;
}
