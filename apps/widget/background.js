/* RhetorLint widget — background service worker.
 * Turns the toolbar button and the keyboard command into a single message
 * to the active tab's content script. No page data is ever read here. */
function tell(tabId) {
  if (tabId != null) chrome.tabs.sendMessage(tabId, "rhetorlint-run").catch(() => {});
}

chrome.action.onClicked.addListener((tab) => tell(tab.id));

chrome.commands.onCommand.addListener((command) => {
  if (command !== "rhetorlint-run") return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) tell(tabs[0].id);
  });
});
