async function enableActionClick(): Promise<void> {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.error('Could not configure the side-panel toolbar action.', error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void enableActionClick();
});

void enableActionClick();
