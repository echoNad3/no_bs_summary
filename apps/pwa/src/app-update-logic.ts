export function isDownloadedBuildInstallable(
  status: string,
  downloadedBuild: number | undefined,
  latestBuild: number | null,
  installedBuild: number | null,
): boolean {
  if (!['ready', 'permission-required'].includes(status) || downloadedBuild === undefined) {
    return false;
  }
  if (latestBuild !== null) return downloadedBuild === latestBuild;
  return installedBuild !== null && downloadedBuild >= installedBuild;
}

export function nextDisplayedDownloadProgress(current: number, reported: number): number {
  const safeCurrent = Math.min(100, Math.max(0, Math.round(current)));
  const safeReported = Math.min(100, Math.max(0, Math.round(reported)));
  return safeCurrent >= safeReported ? safeCurrent : Math.min(safeReported, safeCurrent + 4);
}
