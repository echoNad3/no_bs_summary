import { ApiClientError, summarizeVideo } from '../../shared/api-client.js';
import type { SummaryResult } from '../../shared/api-client.js';
import { renderDetailedSummary } from '../../shared/render-summary.js';
import { readSharedValues } from './share.js';
import './styles.css';

const PASSWORD_STORAGE_KEY = 'nbs-app-password';

const form = requiredElement<HTMLFormElement>('summary-form');
const urlInput = requiredElement<HTMLInputElement>('url');
const titleInput = requiredElement<HTMLInputElement>('title');
const languageInput = requiredElement<HTMLInputElement>('language');
const passwordInput = requiredElement<HTMLInputElement>('password');
const options = requiredElement<HTMLDetailsElement>('options');
const submitButton = requiredElement<HTMLButtonElement>('submit');
const status = requiredElement<HTMLParagraphElement>('status');
const result = requiredElement<HTMLElement>('result');
const shareNote = requiredElement<HTMLParagraphElement>('share-note');

passwordInput.value = loadSavedPassword();

const shared = readSharedValues(window.location.search);
if (shared.url) urlInput.value = shared.url;
if (shared.title) titleInput.value = cleanSharedTitle(shared.title);
shareNote.hidden = !shared.wasShared;

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitSummary();
});

async function submitSummary(): Promise<void> {
  if (!form.reportValidity()) return;
  setBusy(true);
  result.hidden = true;
  status.textContent = 'Reading captions and cutting the padding…';

  const password = passwordInput.value.trim();
  savePassword(password);

  try {
    const response = await summarizeVideo(
      '',
      {
        url: urlInput.value.trim(),
        title: titleInput.value.trim() || undefined,
        language: languageInput.value.trim(),
      },
      { password },
    );
    renderResult(response);
    status.textContent = '';
  } catch (error) {
    status.textContent =
      error instanceof ApiClientError ? error.message : 'Something went wrong. Try again.';
    if (error instanceof ApiClientError && error.code === 'UNAUTHORIZED') {
      options.open = true;
      passwordInput.focus();
    }
  } finally {
    setBusy(false);
  }
}

function loadSavedPassword(): string {
  try {
    return window.localStorage.getItem(PASSWORD_STORAGE_KEY) ?? '';
  } catch {
    return ''; // storage can be unavailable in private browsing
  }
}

function savePassword(password: string): void {
  try {
    if (password) window.localStorage.setItem(PASSWORD_STORAGE_KEY, password);
    else window.localStorage.removeItem(PASSWORD_STORAGE_KEY);
  } catch {
    // storage can be unavailable in private browsing — the password just isn't remembered
  }
}

function renderResult(response: SummaryResult): void {
  const verdict = requiredElement<HTMLSpanElement>('verdict');
  verdict.textContent = response.verdict;
  verdict.dataset.verdict = response.verdict;
  requiredElement<HTMLSpanElement>('meta').textContent =
    `${response.source.toLowerCase()} captions · ${displayTime(response)}`;
  requiredElement<HTMLParagraphElement>('reason').textContent = response.reason;
  renderDetailedSummary(requiredElement<HTMLElement>('summary'), response.summary);
  result.hidden = false;
  result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function displayTime(response: SummaryResult): string {
  const ms = response.timing.totalMs ?? response.timing.summaryMs;
  return `${(ms / 1000).toFixed(1)}s`;
}

function setBusy(busy: boolean): void {
  submitButton.disabled = busy;
  submitButton.textContent = busy ? 'Working…' : 'Cut the bullshit';
  form.setAttribute('aria-busy', String(busy));
}

function cleanSharedTitle(title: string): string {
  return title.replace(/\s+-\s+YouTube$/iu, '').trim();
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}
