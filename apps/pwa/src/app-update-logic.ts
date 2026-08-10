type DownloadedUpdate = {
  status: string;
  build?: number;
};

export function isDownloadedBuildInstallable(
  update: DownloadedUpdate,
  latestBuild: number | null,
  installedBuild: number | null,
): boolean {
  if (update.status !== 'ready' && update.status !== 'permission-required') return false;

  const downloadedBuild = update.build ?? null;
  if (downloadedBuild === null) return false;
  if (latestBuild !== null && downloadedBuild === latestBuild) return true;
  if (installedBuild === null) return false;
  if (latestBuild === null) return downloadedBuild >= installedBuild;
  return latestBuild <= installedBuild && downloadedBuild === installedBuild;
}

export function nextDisplayedDownloadProgress(current: number, reported: number): number {
  const safeCurrent = Math.min(100, Math.max(0, Math.round(current)));
  const safeReported = Math.min(100, Math.max(0, Math.round(reported)));
  return safeCurrent >= safeReported ? safeCurrent : Math.min(safeReported, safeCurrent + 4);
}
