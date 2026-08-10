import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { ApiClientError, checkBackend, summarizeVideo } from '../../shared/api-client.js';
import type { SummarizeInput, SummaryResult } from '../../shared/api-client.js';
import {
  parseSavedSummary,
  parseTextSize,
  safeDiagnosticsText,
  type SavedSummary,
  type TextSize,
} from '../../shared/client-state.js';
import { renderDetailedSummary } from '../../shared/render-summary.js';
import { summaryClipboardText } from '../../shared/summary-actions.js';
import { firstYouTubeUrl, youtubeThumbnailUrl } from '../../shared/youtube-input.js';
import { isDownloadedBuildInstallable, nextDisplayedDownloadProgress } from './app-update-logic.js';
import { AppUpdater, type AppUpdateState } from './app-updater.js';
import { fetchLatestApk, readCachedLatestApk, type LatestApk } from './apk-version.js';
import { hideLaunchScreen } from './launch-screen.js';
import { readSharedValues } from './share.js';
import './styles.css';

const PASSWORD_STORAGE_KEY = 'nbs-app-password';
const LAST_SUMMARY_STORAGE_KEY = 'nbs-last-summary';
const TEXT_SIZE_STORAGE_KEY = 'nbs-text-size';
const APK_DOWNLOAD_URL =
  'https://github.com/echoNad3/no_bs_summary/releases/latest/download/app-debug.apk';
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1_000;
const MIN_UPDATE_CHECK_GAP_MS = 30 * 1_000;

interface RenderedSummary {
  response: SummaryResult;
  title?: string;
  url: string;
}

type AppUpdateUiState =
  | AppUpdateState
  | { status: 'checking' | 'unsupported'; progress: number; detail?: string; build?: number };

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const form = requiredElement<HTMLFormElement>('summary-form');
const urlInput = requiredElement<HTMLInputElement>('url');
const titleInput = requiredElement<HTMLInputElement>('title');
const passwordInput = requiredElement<HTMLInputElement>('password');
const togglePasswordButton = requiredElement<HTMLButtonElement>('toggle-password');
const settingsDialog = requiredElement<HTMLDialogElement>('settings-dialog');
const settingsButton = requiredElement<HTMLButtonElement>('settings-button');
const closeSettingsButton = requiredElement<HTMLButtonElement>('close-settings');
const saveSettingsButton = requiredElement<HTMLButtonElement>('save-settings');
const submitButton = requiredElement<HTMLButtonElement>('submit');
const status = requiredElement<HTMLParagraphElement>('status');
const result = requiredElement<HTMLElement>('result');
const copyButton = requiredElement<HTMLButtonElement>('copy-summary');
const copyButtonLabel = copyButton.querySelector<HTMLElement>('.action-label');
const openVideoLink = requiredElement<HTMLAnchorElement>('open-video');
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
const androidBuilds = requiredElement<HTMLElement>('android-builds');
const androidUpdateStatus = requiredElement<HTMLParagraphElement>('android-update-status');
const appUpdateAction = requiredElement<HTMLButtonElement>('app-update-action');
const appUpdateDetail = requiredElement<HTMLParagraphElement>('app-update-detail');
const appUpdateProgress = requiredElement<HTMLElement>('app-update-progress');
const appUpdateProgressTrack = appUpdateProgress.querySelector<HTMLElement>('[role="progressbar"]');
const appUpdateProgressFill = requiredElement<HTMLElement>('app-update-progress-fill');
const appUpdateProgressValue = requiredElement<HTMLElement>('app-update-progress-value');
const installPwaButton = requiredElement<HTMLButtonElement>('install-pwa');

let activeRequest: AbortController | undefined;
let renderedSummary: RenderedSummary | undefined;
let copyResetTimer: number | undefined;
let lastFailure: Error | undefined;
let latestApk: LatestApk | null = readCachedLatestApk();
let installedBuild: number | null = null;
let appUpdateState: AppUpdateUiState = { status: 'checking', progress: 0 };
let displayedDownloadProgress = 0;
let updaterPollTimer: number | undefined;
let progressAnimationTimer: number | undefined;
let downloadReadyTimer: number | undefined;
let downloadStarted = false;
let updaterUnsupported = false;
let lastVersionCheckAt = 0;
let installPrompt: InstallPromptEvent | undefined;
let serviceWorkerRegistration: ServiceWorkerRegistration | undefined;
let lastServiceWorkerCheckAt = 0;

const savedPassword = loadSavedPassword();
passwordInput.value = savedPassword;
const savedTextSize = loadTextSize();
textSizeInput.value = savedTextSize;
applyTextSize(savedTextSize);

const shared = readSharedValues(window.location.search);
if (shared.url) urlInput.value = shared.url;
if (shared.title) titleInput.value = cleanSharedTitle(shared.title);
if (shared.wasShared && window.location.search) {
  window.history.replaceState(null, '', window.location.pathname);
}
if (!shared.wasShared) restoreLastSummary();
updateVideoPreview();
shareButton.hidden = typeof navigator.share !== 'function';
updateAndroidUpdateUi();
void hideLaunchScreen();

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitSummary();
});

for (const input of [urlInput, titleInput]) {
  input.addEventListener('input', handleSummaryInputChanged);
  input.addEventListener('input', updateVideoPreview);
}

urlInput.addEventListener('paste', (event) => useYouTubeUrlFromPaste(event, urlInput));
togglePasswordButton.addEventListener('click', togglePasswordVisibility);
copyButton.addEventListener('click', () => void copySummary());
shareButton.addEventListener('click', () => void shareSummary());
cancelButton.addEventListener('click', cancelFromButton);
retryButton.addEventListener('click', () => void submitSummary());
diagnosticsButton.addEventListener('click', () => void copyDiagnostics());
testConnectionButton.addEventListener('click', () => void testConnection());
appUpdateAction.addEventListener('click', () => void handleAppUpdateAction());
installPwaButton.addEventListener('click', () => void installPwa());

textSizeInput.addEventListener('change', () => {
  const size = parseTextSize(textSizeInput.value);
  applyTextSize(size);
  saveTextSize(size);
});

settingsButton.addEventListener('click', openSettings);
closeSettingsButton.addEventListener('click', () => settingsDialog.close());
saveSettingsButton.addEventListener('click', () => settingsDialog.close());
settingsDialog.addEventListener('close', () => {
  savePassword(passwordInput.value.trim());
  saveTextSize(parseTextSize(textSizeInput.value));
  stopUpdaterPolling();
});
videoThumbnail.addEventListener('error', () => {
  videoPreview.hidden = true;
});

window.addEventListener('online', updateConnectivity);
window.addEventListener('offline', updateConnectivity);
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event as InstallPromptEvent;
  installPwaButton.hidden = Capacitor.isNativePlatform();
});
window.addEventListener('appinstalled', () => {
  installPrompt = undefined;
  installPwaButton.hidden = true;
});
window.addEventListener('focus', () => {
  if (settingsDialog.open) void refreshAndroidUpdateInfo();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && settingsDialog.open) {
    void refreshAndroidUpdateInfo();
  }
});
updateConnectivity();
if (!savedPassword) openSettings();

async function submitSummary(): Promise<void> {
  if (activeRequest || !form.reportValidity()) return;
  if (!navigator.onLine) {
    setStatus('Offline. Reconnect and retry.', 'error', 'offline');
    return;
  }

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
  setStatus('Working…');
  savePassword(password);

  try {
    const response = await summarizeVideo('', input, { password, signal: controller.signal });
    if (activeRequest !== controller) return;
    if (settingsDialog.open) settingsDialog.close();
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
      openSettings();
      passwordInput.focus();
    }
  } finally {
    if (activeRequest === controller) {
      activeRequest = undefined;
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
  setBusy(false);
}

function cancelFromButton(): void {
  if (!activeRequest) return;
  cancelActiveRequest();
  setStatus('Cancelled.');
}

function loadSavedPassword(): string {
  try {
    return localStorage.getItem(PASSWORD_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function savePassword(password: string): void {
  try {
    if (password) localStorage.setItem(PASSWORD_STORAGE_KEY, password);
    else localStorage.removeItem(PASSWORD_STORAGE_KEY);
  } catch {
    // The password remains active for this session when storage is unavailable.
  }
}

function togglePasswordVisibility(): void {
  const visible = passwordInput.type === 'text';
  passwordInput.type = visible ? 'password' : 'text';
  togglePasswordButton.setAttribute('aria-pressed', String(!visible));
  togglePasswordButton.setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
}

async function installPwa(): Promise<void> {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = undefined;
  installPwaButton.hidden = true;
  await prompt.prompt();
  await prompt.userChoice;
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
  openVideoLink.href = input.url;
  openVideoLink.target = '_blank';
  result.hidden = false;
  if (behavior.focus !== false) {
    result.focus({ preventScroll: true });
    result.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'nearest',
    });
  }
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
    copyResetTimer = window.setTimeout(() => setCopyButtonLabel('Copy summary'), 2_000);
  } catch {
    setStatus('Copy failed. Select the text and copy it.', 'error');
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
    setStatus('Share failed. Copy it instead.', 'error');
  }
}

async function testConnection(): Promise<void> {
  const password = passwordInput.value.trim();
  savePassword(password);
  testConnectionButton.disabled = true;
  connectionStatus.textContent = 'Testing…';
  try {
    const backend = await checkBackend('', { password, timeoutMs: 8_000 });
    connectionStatus.textContent = backend.dailyGeneration
      ? `Connected · ${backend.dailyGeneration.remaining}/${backend.dailyGeneration.limit} remaining`
      : 'Connected';
  } catch (error) {
    connectionStatus.textContent =
      error instanceof ApiClientError ? error.message : 'Connection failed.';
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
    setStatus('Diagnostics copy failed.', 'error');
  }
}

function saveLastSummary(summary: RenderedSummary | undefined): void {
  if (!summary) return;
  const saved: SavedSummary = { ...summary, savedAt: new Date().toISOString() };
  try {
    localStorage.setItem(LAST_SUMMARY_STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Restoring the last result is optional.
  }
}

function restoreLastSummary(): void {
  try {
    const raw = localStorage.getItem(LAST_SUMMARY_STORAGE_KEY);
    const saved = raw ? parseSavedSummary(JSON.parse(raw) as unknown) : undefined;
    if (!saved) return;
    urlInput.value = saved.url;
    titleInput.value = saved.title ?? '';
    if (settingsDialog.open) settingsDialog.close();
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
    return parseTextSize(localStorage.getItem(TEXT_SIZE_STORAGE_KEY));
  } catch {
    return 'normal';
  }
}

function saveTextSize(size: TextSize): void {
  try {
    localStorage.setItem(TEXT_SIZE_STORAGE_KEY, size);
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

async function refreshAndroidUpdateInfo(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastVersionCheckAt < 30_000) return;
  lastVersionCheckAt = now;

  const tasks: Promise<void>[] = [
    fetchLatestApk()
      .then((latest) => {
        if (latest) latestApk = latest;
      })
      .catch(() => undefined),
  ];
  if (Capacitor.isNativePlatform()) {
    tasks.push(
      CapacitorApp.getInfo()
        .then((info) => {
          const build = Number(info.build);
          if (Number.isInteger(build) && build > 0) installedBuild = build;
        })
        .catch(() => undefined),
    );
  }
  await Promise.all(tasks);
  updateAndroidUpdateUi();
}

async function pollNativeUpdater(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !settingsDialog.open || updaterUnsupported) return;
  try {
    applyAppUpdateState(await AppUpdater.getStatus());
  } catch {
    updaterUnsupported = true;
    appUpdateState = { status: 'unsupported', progress: 0 };
  }
  updateAndroidUpdateUi();
}

function startUpdaterPolling(): void {
  stopUpdaterPolling();
  if (!Capacitor.isNativePlatform()) return;
  updaterUnsupported = false;
  void pollNativeUpdater();
  updaterPollTimer = window.setInterval(() => void pollNativeUpdater(), 150);
}

function stopUpdaterPolling(): void {
  if (updaterPollTimer !== undefined) window.clearInterval(updaterPollTimer);
  updaterPollTimer = undefined;
}

function applyAppUpdateState(state: AppUpdateUiState): void {
  if (state.status !== 'ready' || !downloadStarted) {
    appUpdateState = state;
    animateDownloadProgress(state);
    return;
  }

  if (downloadReadyTimer !== undefined) return;
  appUpdateState = { status: 'downloading', progress: 100, build: state.build };
  animateDownloadProgress(appUpdateState);
  downloadReadyTimer = window.setTimeout(() => {
    downloadReadyTimer = undefined;
    downloadStarted = false;
    appUpdateState = state;
    displayedDownloadProgress = 100;
    updateAndroidUpdateUi();
  }, 1_200);
}

function animateDownloadProgress(state: AppUpdateUiState): void {
  if (progressAnimationTimer !== undefined) window.clearInterval(progressAnimationTimer);
  progressAnimationTimer = undefined;
  if (state.status === 'ready') {
    displayedDownloadProgress = 100;
    return;
  }
  if (state.status !== 'downloading') return;

  const target = Math.min(100, Math.max(0, state.progress));
  progressAnimationTimer = window.setInterval(() => {
    if (displayedDownloadProgress >= target) {
      if (progressAnimationTimer !== undefined) window.clearInterval(progressAnimationTimer);
      progressAnimationTimer = undefined;
      return;
    }
    displayedDownloadProgress = nextDisplayedDownloadProgress(displayedDownloadProgress, target);
    updateAndroidUpdateUi();
  }, 40);
}

async function handleAppUpdateAction(): Promise<void> {
  const nativeUpdater = Capacitor.isNativePlatform() && appUpdateState.status !== 'unsupported';
  if (!nativeUpdater) {
    window.open(APK_DOWNLOAD_URL, '_blank', 'noopener,noreferrer');
    return;
  }

  appUpdateAction.disabled = true;
  const installable = isDownloadedBuildInstallable(
    appUpdateState,
    latestApk?.build ?? null,
    installedBuild,
  );
  if (installable) {
    await installAppUpdate();
    return;
  }
  await startAppUpdate();
}

async function startAppUpdate(): Promise<void> {
  if (downloadReadyTimer !== undefined) window.clearTimeout(downloadReadyTimer);
  downloadReadyTimer = undefined;
  downloadStarted = true;
  displayedDownloadProgress = 0;
  appUpdateState = { status: 'downloading', progress: 0 };
  updateAndroidUpdateUi();
  try {
    applyAppUpdateState(await AppUpdater.download({ url: APK_DOWNLOAD_URL }));
  } catch {
    appUpdateState = { status: 'failed', progress: 0, detail: 'Could not start the download.' };
  }
  updateAndroidUpdateUi();
}

async function installAppUpdate(): Promise<void> {
  try {
    appUpdateState = await AppUpdater.install();
  } catch {
    appUpdateState = {
      status: 'failed',
      progress: 100,
      detail: 'Could not open the installer.',
    };
  }
  updateAndroidUpdateUi();
}

function updateAndroidUpdateUi(): void {
  const native = Capacitor.isNativePlatform();
  const nativeUpdater = native && appUpdateState.status !== 'unsupported';
  const latestBuild = latestApk?.build ?? null;
  const updateAvailable =
    native && latestBuild !== null && installedBuild !== null && latestBuild > installedBuild;
  const upToDate =
    native && latestBuild !== null && installedBuild !== null && latestBuild <= installedBuild;
  const installable = isDownloadedBuildInstallable(appUpdateState, latestBuild, installedBuild);
  const downloadedBuild = appUpdateState.build ?? null;
  const reinstallReady =
    installable &&
    downloadedBuild !== null &&
    installedBuild !== null &&
    downloadedBuild === installedBuild;

  androidBuilds.textContent = native
    ? [installedBuild && `Installed ${installedBuild}`, latestBuild && `Latest ${latestBuild}`]
        .filter(Boolean)
        .join(' · ')
    : latestBuild
      ? `Build ${latestBuild}`
      : '';

  appUpdateProgress.hidden = !nativeUpdater || appUpdateState.status !== 'downloading';
  const progress = Math.min(100, Math.max(0, Math.round(displayedDownloadProgress)));
  appUpdateProgressFill.style.width = `${progress}%`;
  appUpdateProgressValue.textContent = `${progress}%`;
  appUpdateProgressTrack?.setAttribute('aria-valuenow', String(progress));

  if (appUpdateState.detail) {
    appUpdateDetail.textContent = appUpdateState.detail;
    appUpdateDetail.dataset.state = appUpdateState.status === 'failed' ? 'error' : '';
  } else if (appUpdateState.status === 'ready' && installable) {
    appUpdateDetail.textContent = reinstallReady
      ? `Build ${downloadedBuild} is already installed.`
      : `Build ${downloadedBuild} is ready to install.`;
    appUpdateDetail.dataset.state = '';
  } else if (appUpdateState.status === 'ready') {
    appUpdateDetail.textContent = 'The saved download is outdated.';
    appUpdateDetail.dataset.state = '';
  } else {
    appUpdateDetail.textContent = '';
    appUpdateDetail.dataset.state = '';
  }

  if (appUpdateState.status === 'downloading') {
    androidUpdateStatus.textContent = 'Downloading…';
    appUpdateAction.textContent = 'Downloading…';
    appUpdateAction.disabled = true;
  } else if (appUpdateState.status === 'installing') {
    androidUpdateStatus.textContent = 'Installer opened.';
    appUpdateAction.textContent = 'Installer opened';
    appUpdateAction.disabled = true;
  } else if (installable) {
    androidUpdateStatus.textContent = updateAvailable ? 'Update ready.' : 'Ready to install.';
    appUpdateAction.textContent = reinstallReady
      ? `Reinstall build ${downloadedBuild}`
      : `Install build ${downloadedBuild}`;
    appUpdateAction.disabled = false;
  } else if (!nativeUpdater) {
    androidUpdateStatus.textContent = latestBuild ? 'APK available.' : 'No APK published yet.';
    appUpdateAction.textContent = native ? 'Download in browser' : 'Download Android app';
    appUpdateAction.disabled = false;
  } else if (updateAvailable) {
    androidUpdateStatus.textContent = 'Update available.';
    appUpdateAction.textContent = `Download build ${latestBuild}`;
    appUpdateAction.disabled = false;
  } else if (upToDate) {
    androidUpdateStatus.textContent = 'Up to date.';
    appUpdateAction.textContent = `Download build ${latestBuild} again`;
    appUpdateAction.disabled = false;
  } else {
    androidUpdateStatus.textContent = 'Installed.';
    appUpdateAction.textContent = 'Download latest build';
    appUpdateAction.disabled = false;
  }
}

function updateConnectivity(): void {
  const online = navigator.onLine;
  submitButton.disabled = Boolean(activeRequest) || !online;
  if (!online) {
    cancelActiveRequest();
    setStatus('Offline. Summaries need a connection.', 'error', 'offline');
  } else if (status.dataset.code === 'offline') {
    setStatus('Back online.');
  }
}

function setBusy(busy: boolean): void {
  submitButton.disabled = busy || !navigator.onLine;
  submitButton.textContent = busy ? 'Working…' : 'Cut the BS';
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
  window.addEventListener('load', () => void registerServiceWorker());
}

async function registerServiceWorker(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    serviceWorkerRegistration = registration;
    registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          installing.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    });
    checkForWebUpdate(true);

    const checkWhenVisible = () => {
      if (document.visibilityState === 'visible') checkForWebUpdate();
    };
    window.addEventListener('focus', checkWhenVisible);
    window.addEventListener('online', () => checkForWebUpdate(true));
    document.addEventListener('visibilitychange', checkWhenVisible);
    window.setInterval(checkWhenVisible, UPDATE_CHECK_INTERVAL_MS);
  } catch {
    // The online app still works when service worker registration is blocked.
  }
}

function checkForWebUpdate(force = false): void {
  if (!serviceWorkerRegistration || !navigator.onLine) return;
  const now = Date.now();
  if (!force && now - lastServiceWorkerCheckAt < MIN_UPDATE_CHECK_GAP_MS) return;
  lastServiceWorkerCheckAt = now;
  void serviceWorkerRegistration.update().catch(() => undefined);
}

function openSettings(): void {
  if (!settingsDialog.open) settingsDialog.showModal();
  void refreshAndroidUpdateInfo();
  startUpdaterPolling();
}
