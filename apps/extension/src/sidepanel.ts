import { ApiClientError, checkBackend, summarizeVideo } from '../../shared/api-client.js';
import type { SummarizeInput, SummaryResult } from '../../shared/api-client.js';
import {
  parseTextSize,
  safeDiagnosticsText,
  type SavedSummary,
} from '../../shared/client-state.js';
import { renderDetailedSummary } from '../../shared/render-summary.js';
import { summaryClipboardText } from '../../shared/summary-actions.js';
import { firstYouTubeUrl, youtubeThumbnailUrl } from '../../shared/youtube-input.js';
import { getYouTubeTabContext } from './tab-context.js';
import {
  DEFAULT_BACKEND_URL,
  loadLastSummary,
  loadSettings,
  saveLastSummary,
  saveSettings,
} from './settings.js';
import './styles.css';

interface RenderedSummary {
  response: SummaryResult;
  title?: string;
  url: string;
}

const form = requiredElement<HTMLFormElement>('summary-form');
const urlInput = requiredElement<HTMLInputElement>('url');
const titleInput = requiredElement<HTMLInputElement>('title');
const passwordInput = requiredElement<HTMLInputElement>('password');
const showPasswordInput = requiredElement<HTMLInputElement>('show-password');
const submitButton = requiredElement<HTMLButtonElement>('submit');
const copyButton = requiredElement<HTMLButtonElement>('copy-summary');
const copyButtonLabel = copyButton.querySelector<HTMLElement>('.action-label');
const status = requiredElement<HTMLParagraphElement>('status');
const result = requiredElement<HTMLElement>('result');
const videoContext = requiredElement<HTMLElement>('video-context');
const contextLabel = requiredElement<HTMLSpanElement>('context-label');
const detectedTitle = requiredElement<HTMLElement>('detected-title');
const settingsDialog = requiredElement<HTMLDialogElement>('settings-dialog');
const settingsButton = requiredElement<HTMLButtonElement>('settings-button');
const closeSettingsButton = requiredElement<HTMLButtonElement>('close-settings');
const saveSettingsButton = requiredElement<HTMLButtonElement>('save-settings');
const cancelButton = requiredElement<HTMLButtonElement>('cancel-request');
const retryButton = requiredElement<HTMLButtonElement>('retry-request');
const diagnosticsButton = requiredElement<HTMLButtonElement>('copy-diagnostics');
const errorActions = requiredElement<HTMLElement>('error-actions');
const testConnectionButton = requiredElement<HTMLButtonElement>('test-connection');
const connectionStatus = requiredElement<HTMLParagraphElement>('connection-status');
const textSizeInput = requiredElement<HTMLSelectElement>('text-size');
const videoThumbnail = requiredElement<HTMLImageElement>('video-thumbnail');

let detectedUrl: string | undefined;
let detectedVideoId: string | undefined;
let activeTabId: number | undefined;
let activeRequest: AbortController | undefined;
let renderedSummary: RenderedSummary | undefined;
let copyResetTimer: number | undefined;
let refreshVersion = 0;
let manualOverride = false;
let elapsedTimer: number | undefined;
let requestStartedAt = 0;
let lastFailure: Error | undefined;
let savedSummary: SavedSummary | undefined;

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitSummary();
});

urlInput.addEventListener('input', () => {
  manualOverride = true;
  detectedUrl = undefined;
  detectedVideoId = undefined;
  titleInput.value = '';
  contextLabel.textContent = 'Manual link';
  detectedTitle.textContent = urlInput.value.trim()
    ? 'Using pasted YouTube link'
    : 'Paste a link below';
  videoContext.dataset.detected = 'false';
  updateThumbnail(urlInput.value);
  showControlsForNewVideo();
});

urlInput.addEventListener('paste', (event) => {
  useYouTubeUrlFromPaste(event, urlInput);
});

showPasswordInput.addEventListener('change', () => {
  passwordInput.type = showPasswordInput.checked ? 'text' : 'password';
});

copyButton.addEventListener('click', () => {
  void copySummary();
});

cancelButton.addEventListener('click', cancelFromButton);
retryButton.addEventListener('click', () => void submitSummary());
diagnosticsButton.addEventListener('click', () => void copyDiagnostics());
testConnectionButton.addEventListener('click', () => void testConnection());

textSizeInput.addEventListener('change', () => {
  const textSize = parseTextSize(textSizeInput.value);
  applyTextSize(textSize);
  void saveSettings({ password: passwordInput.value.trim(), textSize });
});

settingsButton.addEventListener('click', openSettings);
closeSettingsButton.addEventListener('click', () => settingsDialog.close());
saveSettingsButton.addEventListener('click', () => settingsDialog.close());
settingsDialog.addEventListener('close', () => {
  void saveSettings({
    password: passwordInput.value.trim(),
    textSize: parseTextSize(textSizeInput.value),
  });
});
videoThumbnail.addEventListener('error', () => {
  videoThumbnail.hidden = true;
});

chrome.tabs.onActivated.addListener(() => {
  manualOverride = false;
  void fillFromActiveTab();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId !== activeTabId || (!changeInfo.url && !changeInfo.title)) return;
  if (changeInfo.url) manualOverride = false;
  if (!manualOverride) void fillFromActiveTab();
});

void initialize();

async function initialize(): Promise<void> {
  const [settings, storedSummary] = await Promise.all([loadSettings(), loadLastSummary()]);
  savedSummary = storedSummary;
  passwordInput.value = settings.password;
  textSizeInput.value = settings.textSize;
  applyTextSize(settings.textSize);
  await fillFromActiveTab();
  if (!settings.password) openSettings();
}

async function fillFromActiveTab(): Promise<void> {
  const version = ++refreshVersion;
  let tab: chrome.tabs.Tab | undefined;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    return;
  }
  if (version !== refreshVersion) return;
  activeTabId = tab?.id;

  const context = getYouTubeTabContext(tab);
  if (!context) {
    clearDetectedVideo();
    return;
  }

  const changedVideo = detectedVideoId !== context.videoId;
  if (changedVideo) showControlsForNewVideo();
  detectedUrl = context.url;
  detectedVideoId = context.videoId;
  urlInput.value = context.url;
  titleInput.value = context.title ?? '';
  contextLabel.textContent = 'Current video';
  detectedTitle.textContent = context.title ?? 'YouTube video';
  videoContext.dataset.detected = 'true';
  updateThumbnail(context.url);
  if (changedVideo && savedSummary?.response.videoId === context.videoId) {
    restoreSummary(savedSummary);
  } else if (!changedVideo && renderedSummary) {
    renderedSummary.url = context.url;
    renderedSummary.title = context.title;
  }
}

async function submitSummary(): Promise<void> {
  if (activeRequest || !form.reportValidity()) return;

  const input: SummarizeInput = {
    url: urlInput.value.trim(),
    title: titleInput.value.trim() || undefined,
    language: 'en',
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
  await saveSettings({ password, textSize: parseTextSize(textSizeInput.value) });

  try {
    const response = await summarizeVideo(DEFAULT_BACKEND_URL, input, {
      password,
      signal: controller.signal,
    });
    if (activeRequest !== controller) return;
    renderResult(response, input);
    if (renderedSummary) {
      savedSummary = { ...renderedSummary, savedAt: new Date().toISOString() };
      await saveLastSummary(savedSummary);
    }
    setStatus('Summary ready.', 'success');
    if (settingsDialog.open) settingsDialog.close();
    document.body.classList.add('has-result');
  } catch (error) {
    if (activeRequest !== controller) return;
    if (error instanceof ApiClientError && error.code === 'REQUEST_CANCELLED') return;
    lastFailure = error instanceof Error ? error : new Error('Unknown client error');
    document.body.classList.remove('has-result');
    setStatus(
      error instanceof ApiClientError ? error.message : 'Something went wrong. Try again.',
      'error',
    );
    errorActions.hidden = false;
    if (error instanceof ApiClientError && error.code === 'UNAUTHORIZED') {
      openSettings();
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

function renderResult(
  response: SummaryResult,
  input: SummarizeInput,
  behavior: { focus?: boolean } = { focus: true },
): void {
  renderedSummary = { response, title: input.title, url: input.url };
  const verdict = requiredElement<HTMLSpanElement>('verdict');
  verdict.textContent = response.verdict;
  verdict.dataset.verdict = response.verdict;
  requiredElement<HTMLParagraphElement>('reason').textContent = response.reason;
  renderDetailedSummary(requiredElement<HTMLElement>('summary'), response.summary);
  result.hidden = false;
  if (behavior.focus !== false) {
    result.focus({ preventScroll: true });
    result.scrollIntoView({ block: 'nearest' });
  }
}

function setBusy(busy: boolean): void {
  submitButton.disabled = busy;
  submitButton.textContent = busy ? 'Working…' : 'Cut the BS';
  cancelButton.hidden = !busy;
  form.setAttribute('aria-busy', String(busy));
}

function clearDetectedVideo(): void {
  const previousDetectedUrl = detectedUrl;
  detectedUrl = undefined;
  detectedVideoId = undefined;
  titleInput.value = '';
  videoThumbnail.hidden = true;
  videoThumbnail.removeAttribute('src');

  if (manualOverride && urlInput.value.trim()) {
    contextLabel.textContent = 'Manual link';
    detectedTitle.textContent = 'Using pasted YouTube link';
  } else {
    if (previousDetectedUrl && urlInput.value === previousDetectedUrl) urlInput.value = '';
    contextLabel.textContent = 'Current video';
    detectedTitle.textContent = 'No YouTube video detected';
  }

  videoContext.dataset.detected = 'false';
  showControlsForNewVideo();
}

function showControlsForNewVideo(): void {
  cancelActiveRequest();
  clearResult();
  errorActions.hidden = true;
  lastFailure = undefined;
  document.body.classList.remove('has-result');
  setStatus('');
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

function clearResult(): void {
  renderedSummary = undefined;
  result.hidden = true;
  setCopyButtonLabel('Copy summary');
  if (copyResetTimer !== undefined) window.clearTimeout(copyResetTimer);
}

function setCopyButtonLabel(label: string): void {
  copyButton.setAttribute('aria-label', label);
  if (copyButtonLabel) copyButtonLabel.textContent = label;
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
    setCopyButtonLabel('Copied');
    setStatus('Copied.', 'success');
    if (copyResetTimer !== undefined) window.clearTimeout(copyResetTimer);
    copyResetTimer = window.setTimeout(() => {
      setCopyButtonLabel('Copy summary');
    }, 2_000);
  } catch {
    setStatus('Copy failed. Select the text and copy it.', 'error');
  }
}

async function testConnection(): Promise<void> {
  const password = passwordInput.value.trim();
  await saveSettings({ password, textSize: parseTextSize(textSizeInput.value) });
  testConnectionButton.disabled = true;
  connectionStatus.textContent = 'Testing…';
  try {
    const backend = await checkBackend(DEFAULT_BACKEND_URL, { password, timeoutMs: 8_000 });
    connectionStatus.textContent = backend.dailyGeneration
      ? `Connected · ${backend.dailyGeneration.remaining}/${backend.dailyGeneration.limit} remaining`
      : 'Connected';
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
      safeDiagnosticsText('Chrome extension', lastFailure, navigator.onLine, navigator.userAgent),
    );
    diagnosticsButton.textContent = 'Copied diagnostics';
  } catch {
    setStatus('Diagnostics copy failed.', 'error');
  }
}

function startElapsedTimer(): void {
  requestStartedAt = Date.now();
  updateElapsedStatus();
  elapsedTimer = window.setInterval(updateElapsedStatus, 1_000);
}

function updateElapsedStatus(): void {
  const seconds = Math.floor((Date.now() - requestStartedAt) / 1_000);
  setStatus(`Reading captions… ${seconds}s`);
}

function stopElapsedTimer(): void {
  if (elapsedTimer !== undefined) window.clearInterval(elapsedTimer);
  elapsedTimer = undefined;
}

function restoreSummary(saved: SavedSummary): void {
  const url = detectedUrl ?? saved.url;
  const title = titleInput.value.trim() || saved.title;
  renderResult(saved.response, { url, title, language: saved.response.language }, { focus: false });
  if (settingsDialog.open) settingsDialog.close();
  document.body.classList.add('has-result');
}

function updateThumbnail(url: string): void {
  const thumbnail = youtubeThumbnailUrl(url);
  if (!thumbnail) {
    videoThumbnail.hidden = true;
    videoThumbnail.removeAttribute('src');
    return;
  }
  videoThumbnail.src = thumbnail;
  videoThumbnail.hidden = false;
}

function applyTextSize(size: ReturnType<typeof parseTextSize>): void {
  document.documentElement.dataset.textSize = size;
}

function setStatus(message: string, state: 'info' | 'success' | 'error' = 'info'): void {
  status.textContent = message;
  status.dataset.state = message ? state : '';
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

function openSettings(): void {
  if (!settingsDialog.open) settingsDialog.showModal();
}
