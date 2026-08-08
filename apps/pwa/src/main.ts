import { ApiClientError, checkBackend, summarizeVideo } from '../../shared/api-client.js';
import type { SummarizeInput, SummaryResult } from '../../shared/api-client.js';
import {
  parseSavedSummary,
  parseTextSize,
  safeDiagnosticsText,
  summaryReadingStats,
  type SavedSummary,
  type TextSize,
} from '../../shared/client-state.js';
import { renderDetailedSummary } from '../../shared/render-summary.js';
import { summaryClipboardText } from '../../shared/summary-actions.js';
import { firstYouTubeUrl, youtubeThumbnailUrl } from '../../shared/youtube-input.js';
import { readSharedValues } from './share.js';
import './styles.css';

const PASSWORD_STORAGE_KEY = 'nbs-app-password';
const LAST_SUMMARY_STORAGE_KEY = 'nbs-last-summary';
const TEXT_SIZE_STORAGE_KEY = 'nbs-text-size';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface RenderedSummary {
  response: SummaryResult;
  title?: string;
  url: string;
}

const form = requiredElement<HTMLFormElement>('summary-form');
const urlInput = requiredElement<HTMLInputElement>('url');
const titleInput = requiredElement<HTMLInputElement>('title');
const languageInput = requiredElement<HTMLInputElement>('language');
const passwordInput = requiredElement<HTMLInputElement>('password');
const showPasswordInput = requiredElement<HTMLInputElement>('show-password');
const options = requiredElement<HTMLDetailsElement>('options');
const submitButton = requiredElement<HTMLButtonElement>('submit');
const status = requiredElement<HTMLParagraphElement>('status');
const result = requiredElement<HTMLElement>('result');
const shareNote = requiredElement<HTMLParagraphElement>('share-note');
const copyButton = requiredElement<HTMLButtonElement>('copy-summary');
const openVideoLink = requiredElement<HTMLAnchorElement>('open-video');
const installButton = requiredElement<HTMLButtonElement>('install-app');
const updateButton = requiredElement<HTMLButtonElement>('update-app');
const shareButton = requiredElement<HTMLButtonElement>('share-summary');
const cancelButton = requiredElement<HTMLButtonElement>('cancel-request');
const retryButton = requiredElement<HTMLButtonElement>('retry-request');
const diagnosticsButton = requiredElement<HTMLButtonElement>('copy-diagnostics');
const errorActions = requiredElement<HTMLElement>('error-actions');
const testConnectionButton = requiredElement<HTMLButtonElement>('test-connection');
const connectionStatus = requiredElement<HTMLParagraphElement>('connection-status');
const textSizeInput = requiredElement<HTMLSelectElement>('text-size');
const videoPreview = requiredElement<HTMLElement>('video-preview');
const videoThumbnail = requiredElement<HTMLImageElement>('video-thumbnail');
const previewTitle = requiredElement<HTMLElement>('preview-title');
const helpButton = requiredElement<HTMLButtonElement>('help-button');
const helpDialog = requiredElement<HTMLDialogElement>('help-dialog');
const closeHelpButton = requiredElement<HTMLButtonElement>('close-help');

let activeRequest: AbortController | undefined;
let renderedSummary: RenderedSummary | undefined;
let installPrompt: BeforeInstallPromptEvent | undefined;
let copyResetTimer: number | undefined;
let elapsedTimer: number | undefined;
let requestStartedAt = 0;
let lastFailure: Error | undefined;
let serviceWorkerRegistration: ServiceWorkerRegistration | undefined;
let reloadForUpdate = false;

const savedPassword = loadSavedPassword();
passwordInput.value = savedPassword;
options.open = savedPassword === '';
const savedTextSize = loadTextSize();
textSizeInput.value = savedTextSize;
applyTextSize(savedTextSize);

const shared = readSharedValues(window.location.search);
if (shared.url) urlInput.value = shared.url;
if (shared.title) titleInput.value = cleanSharedTitle(shared.title);
shareNote.hidden = !shared.wasShared;
if (shared.wasShared && window.location.search) {
  window.history.replaceState(null, '', window.location.pathname);
}
if (!shared.wasShared) restoreLastSummary();
updateVideoPreview();
shareButton.hidden = typeof navigator.share !== 'function';

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitSummary();
});

for (const input of [urlInput, titleInput, languageInput]) {
  input.addEventListener('input', handleSummaryInputChanged);
}

for (const input of [urlInput, titleInput]) {
  input.addEventListener('input', updateVideoPreview);
}

urlInput.addEventListener('paste', (event) => {
  useYouTubeUrlFromPaste(event, urlInput);
});

showPasswordInput.addEventListener('change', () => {
  passwordInput.type = showPasswordInput.checked ? 'text' : 'password';
});

copyButton.addEventListener('click', () => {
  void copySummary();
});

shareButton.addEventListener('click', () => {
  void shareSummary();
});

cancelButton.addEventListener('click', cancelFromButton);
retryButton.addEventListener('click', () => void submitSummary());
diagnosticsButton.addEventListener('click', () => void copyDiagnostics());
testConnectionButton.addEventListener('click', () => void testConnection());

textSizeInput.addEventListener('change', () => {
  const size = parseTextSize(textSizeInput.value);
  applyTextSize(size);
  saveTextSize(size);
});

helpButton.addEventListener('click', () => helpDialog.showModal());
closeHelpButton.addEventListener('click', () => helpDialog.close());
videoThumbnail.addEventListener('error', () => {
  videoPreview.hidden = true;
});

updateButton.addEventListener('click', () => {
  reloadForUpdate = true;
  serviceWorkerRegistration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
});

installButton.addEventListener('click', () => {
  void installApp();
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event as BeforeInstallPromptEvent;
  installButton.hidden = false;
});

window.addEventListener('appinstalled', () => {
  installPrompt = undefined;
  installButton.hidden = true;
});

window.addEventListener('online', updateConnectivity);
window.addEventListener('offline', updateConnectivity);
updateConnectivity();

async function submitSummary(): Promise<void> {
  if (activeRequest || !form.reportValidity()) return;
  if (!navigator.onLine) {
    setStatus('You are offline. Reconnect, then try again.', 'error', 'offline');
    return;
  }

  const input: SummarizeInput = {
    url: urlInput.value.trim(),
    title: titleInput.value.trim() || undefined,
    language: languageInput.value.trim(),
  };
  const password = passwordInput.value.trim();
  const controller = new AbortController();
  activeRequest = controller;
  lastFailure = undefined;
  errorActions.hidden = true;
  diagnosticsButton.textContent = 'Copy diagnostics';
  clearResult();
  setBusy(true);
  startElapsedTimer();
  savePassword(password);

  try {
    const response = await summarizeVideo('', input, {
      password,
      signal: controller.signal,
    });
    if (activeRequest !== controller) return;
    options.open = false;
    renderResult(response, input);
    saveLastSummary(renderedSummary);
    setStatus('Summary ready.', 'success');
  } catch (error) {
    if (activeRequest !== controller) return;
    if (error instanceof ApiClientError && error.code === 'REQUEST_CANCELLED') return;
    lastFailure = error instanceof Error ? error : new Error('Unknown client error');
    setStatus(
      error instanceof ApiClientError ? error.message : 'Something went wrong. Try again.',
      'error',
    );
    errorActions.hidden = false;
    if (error instanceof ApiClientError && error.code === 'UNAUTHORIZED') {
      options.open = true;
      passwordInput.focus();
    }
  } finally {
    if (activeRequest === controller) {
      activeRequest = undefined;
      stopElapsedTimer();
      setBusy(false);
    }
  }
}

function handleSummaryInputChanged(): void {
  cancelActiveRequest();
  clearResult();
  errorActions.hidden = true;
  lastFailure = undefined;
  if (status.dataset.code !== 'offline') setStatus('');
}

function cancelActiveRequest(): void {
  if (!activeRequest) return;
  activeRequest.abort();
  activeRequest = undefined;
  stopElapsedTimer();
  setBusy(false);
}

function cancelFromButton(): void {
  if (!activeRequest) return;
  cancelActiveRequest();
  setStatus('Cancelled.');
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
    // Storage can be unavailable in private browsing; the password just isn't remembered.
  }
}

function renderResult(
  response: SummaryResult,
  input: SummarizeInput,
  behavior: { focus?: boolean } = { focus: true },
): void {
  renderedSummary = { response, title: input.title, url: input.url };
  const verdict = requiredElement<HTMLSpanElement>('verdict');
  verdict.textContent = response.verdict;
  verdict.dataset.verdict = response.verdict;
  requiredElement<HTMLSpanElement>('meta').textContent =
    `${response.source.toLowerCase()} captions \u00b7 ${displayTime(response)}`;
  requiredElement<HTMLParagraphElement>('reason').textContent = response.reason;
  renderDetailedSummary(requiredElement<HTMLElement>('summary'), response.summary);
  const stats = summaryReadingStats(response.summary);
  requiredElement<HTMLElement>('reading-stats').textContent =
    `${stats.minutes} min read · ${stats.words} words`;
  openVideoLink.href = input.url;
  openVideoLink.target = '_blank';
  result.hidden = false;
  if (behavior.focus !== false) {
    result.focus({ preventScroll: true });
    result.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'nearest',
    });
  }
}

function clearResult(): void {
  renderedSummary = undefined;
  result.hidden = true;
  copyButton.textContent = 'Copy summary';
  if (copyResetTimer !== undefined) window.clearTimeout(copyResetTimer);
}

async function copySummary(): Promise<void> {
  if (!renderedSummary) return;
  try {
    await navigator.clipboard.writeText(
      summaryClipboardText(renderedSummary.response, {
        title: renderedSummary.title,
        url: renderedSummary.url,
      }),
    );
    copyButton.textContent = 'Copied';
    setStatus('Summary copied.', 'success');
    if (copyResetTimer !== undefined) window.clearTimeout(copyResetTimer);
    copyResetTimer = window.setTimeout(() => {
      copyButton.textContent = 'Copy summary';
    }, 2_000);
  } catch {
    setStatus('Could not copy the summary. Select the text and copy it manually.', 'error');
  }
}

async function shareSummary(): Promise<void> {
  if (!renderedSummary || typeof navigator.share !== 'function') return;
  try {
    await navigator.share({
      title: renderedSummary.title || 'No BS Summary',
      text: summaryClipboardText(renderedSummary.response, {
        title: renderedSummary.title,
        url: renderedSummary.url,
      }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    setStatus('Could not open the share menu. Copy the summary instead.', 'error');
  }
}

async function testConnection(): Promise<void> {
  const password = passwordInput.value.trim();
  savePassword(password);
  testConnectionButton.disabled = true;
  connectionStatus.textContent = 'Testing...';
  try {
    const backend = await checkBackend('', { password, timeoutMs: 8_000 });
    connectionStatus.textContent = backend.dailyGeneration
      ? `Connected. Cloud cache ready. ${backend.dailyGeneration.remaining} of ${backend.dailyGeneration.limit} new-summary slots remain today.`
      : 'Connected. Local backend ready.';
  } catch (error) {
    connectionStatus.textContent =
      error instanceof ApiClientError ? error.message : 'Connection test failed.';
    if (error instanceof ApiClientError && error.code === 'UNAUTHORIZED') passwordInput.focus();
  } finally {
    testConnectionButton.disabled = false;
  }
}

async function copyDiagnostics(): Promise<void> {
  if (!lastFailure) return;
  try {
    await navigator.clipboard.writeText(
      safeDiagnosticsText('PWA', lastFailure, navigator.onLine, navigator.userAgent),
    );
    diagnosticsButton.textContent = 'Copied diagnostics';
  } catch {
    setStatus('Could not copy diagnostics.', 'error');
  }
}

function startElapsedTimer(): void {
  requestStartedAt = Date.now();
  updateElapsedStatus();
  elapsedTimer = window.setInterval(updateElapsedStatus, 1_000);
}

function updateElapsedStatus(): void {
  const seconds = Math.floor((Date.now() - requestStartedAt) / 1_000);
  setStatus(`Reading captions and cutting the padding... ${seconds}s`);
}

function stopElapsedTimer(): void {
  if (elapsedTimer !== undefined) window.clearInterval(elapsedTimer);
  elapsedTimer = undefined;
}

function saveLastSummary(summary: RenderedSummary | undefined): void {
  if (!summary) return;
  const saved: SavedSummary = { ...summary, savedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(LAST_SUMMARY_STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Restoring the last result is optional when browser storage is unavailable.
  }
}

function restoreLastSummary(): void {
  try {
    const raw = window.localStorage.getItem(LAST_SUMMARY_STORAGE_KEY);
    const saved = raw ? parseSavedSummary(JSON.parse(raw) as unknown) : undefined;
    if (!saved) return;
    urlInput.value = saved.url;
    titleInput.value = saved.title ?? '';
    languageInput.value = saved.response.language;
    options.open = false;
    renderResult(
      saved.response,
      { url: saved.url, title: saved.title, language: saved.response.language },
      { focus: false },
    );
  } catch {
    // Ignore corrupt or unavailable saved state.
  }
}

function loadTextSize(): TextSize {
  try {
    return parseTextSize(window.localStorage.getItem(TEXT_SIZE_STORAGE_KEY));
  } catch {
    return 'normal';
  }
}

function saveTextSize(size: TextSize): void {
  try {
    window.localStorage.setItem(TEXT_SIZE_STORAGE_KEY, size);
  } catch {
    // Preference remains active for this session.
  }
}

function applyTextSize(size: TextSize): void {
  document.documentElement.dataset.textSize = size;
}

function updateVideoPreview(): void {
  const thumbnail = youtubeThumbnailUrl(urlInput.value);
  if (!thumbnail) {
    videoPreview.hidden = true;
    videoThumbnail.removeAttribute('src');
    return;
  }
  videoThumbnail.src = thumbnail;
  previewTitle.textContent = titleInput.value.trim() || 'YouTube video';
  videoPreview.hidden = false;
}

async function installApp(): Promise<void> {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = undefined;
  installButton.hidden = true;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  if (choice.outcome === 'dismissed') installButton.hidden = false;
}

function updateConnectivity(): void {
  const online = navigator.onLine;
  submitButton.disabled = Boolean(activeRequest) || !online;
  if (!online) {
    cancelActiveRequest();
    setStatus(
      'You are offline. The app is ready, but summaries need a connection.',
      'error',
      'offline',
    );
  } else if (status.dataset.code === 'offline') {
    setStatus('Back online.');
  }
}

function displayTime(response: SummaryResult): string {
  const ms = response.timing.totalMs ?? response.timing.summaryMs;
  return `${(ms / 1000).toFixed(1)}s`;
}

function setBusy(busy: boolean): void {
  submitButton.disabled = busy || !navigator.onLine;
  submitButton.textContent = busy ? 'Working...' : 'Cut the BS';
  cancelButton.hidden = !busy;
  form.setAttribute('aria-busy', String(busy));
}

function setStatus(message: string, state: 'info' | 'success' | 'error' = 'info', code = ''): void {
  status.textContent = message;
  status.dataset.state = message ? state : '';
  status.dataset.code = code;
}

function cleanSharedTitle(title: string): string {
  return title.replace(/\s+-\s+YouTube$/iu, '').trim();
}

function useYouTubeUrlFromPaste(event: ClipboardEvent, input: HTMLInputElement): void {
  const pasted = event.clipboardData?.getData('text') ?? '';
  const url = firstYouTubeUrl(pasted);
  if (!url || url === pasted.trim()) return;
  event.preventDefault();
  input.value = url;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void registerServiceWorker();
  });
}

async function registerServiceWorker(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    serviceWorkerRegistration = registration;
    if (registration.waiting) updateButton.hidden = false;
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          updateButton.hidden = false;
        }
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadForUpdate) window.location.reload();
    });
  } catch {
    // The online app still works when service worker registration is blocked.
  }
}
