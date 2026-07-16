import { ApiClientError, summarizeVideo } from '../../shared/api-client.js';
import type { SummaryResult } from '../../shared/api-client.js';
import { renderDetailedSummary } from '../../shared/render-summary.js';
import { getYouTubeTabContext } from './tab-context.js';
import './styles.css';

const API_BASE = 'http://127.0.0.1:8787';

const form = requiredElement<HTMLFormElement>('summary-form');
const urlInput = requiredElement<HTMLInputElement>('url');
const titleInput = requiredElement<HTMLInputElement>('title');
const languageInput = requiredElement<HTMLInputElement>('language');
const submitButton = requiredElement<HTMLButtonElement>('submit');
const status = requiredElement<HTMLParagraphElement>('status');
const result = requiredElement<HTMLElement>('result');
const videoContext = requiredElement<HTMLElement>('video-context');
const contextLabel = requiredElement<HTMLSpanElement>('context-label');
const detectedTitle = requiredElement<HTMLElement>('detected-title');
const fallbackControls = requiredElement<HTMLDetailsElement>('fallback-controls');

let detectedUrl: string | undefined;

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitSummary();
});

urlInput.addEventListener('input', () => {
  detectedUrl = undefined;
  titleInput.value = '';
  contextLabel.textContent = 'Manual link';
  detectedTitle.textContent = urlInput.value.trim()
    ? 'Using pasted YouTube link'
    : 'Paste a link below';
  videoContext.dataset.detected = 'false';
  showControlsForNewVideo();
});

chrome.tabs.onActivated.addListener(() => {
  void fillFromActiveTab();
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.title) void fillFromActiveTab();
});

void fillFromActiveTab();

async function fillFromActiveTab(): Promise<void> {
  let tab: chrome.tabs.Tab | undefined;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    return;
  }
  const context = getYouTubeTabContext(tab);
  if (!context) {
    clearDetectedVideo();
    return;
  }

  const changedVideo = detectedUrl !== context.url;
  detectedUrl = context.url;
  urlInput.value = context.url;
  titleInput.value = context.title ?? '';
  contextLabel.textContent = 'Current video';
  detectedTitle.textContent = context.title ?? 'YouTube video';
  videoContext.dataset.detected = 'true';
  fallbackControls.open = false;
  if (changedVideo) showControlsForNewVideo();
}

async function submitSummary(): Promise<void> {
  if (!form.reportValidity()) return;
  setBusy(true);
  result.hidden = true;
  status.textContent = 'Reading captions and cutting the padding…';

  try {
    const response = await summarizeVideo(API_BASE, {
      url: urlInput.value.trim(),
      title: titleInput.value.trim() || undefined,
      language: languageInput.value.trim(),
    });
    renderResult(response);
    status.textContent = '';
    fallbackControls.open = false;
    document.body.classList.add('has-result');
  } catch (error) {
    document.body.classList.remove('has-result');
    status.textContent =
      error instanceof ApiClientError ? error.message : 'Something went wrong. Try again.';
  } finally {
    setBusy(false);
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

function clearDetectedVideo(): void {
  const previousDetectedUrl = detectedUrl;
  detectedUrl = undefined;
  if (previousDetectedUrl && urlInput.value === previousDetectedUrl) urlInput.value = '';
  titleInput.value = '';
  contextLabel.textContent = 'Current video';
  detectedTitle.textContent = 'No YouTube video detected';
  videoContext.dataset.detected = 'false';
  fallbackControls.open = true;
  showControlsForNewVideo();
}

function showControlsForNewVideo(): void {
  document.body.classList.remove('has-result');
  result.hidden = true;
  status.textContent = '';
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}
