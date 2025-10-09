// Cross-browser API compatibility
// @ts-expect-error - browser global exists in Firefox, chrome in Chrome
const browserAPI: typeof chrome & typeof browser =
	(globalThis as any).browser || (globalThis as any).chrome;

const isFirefox =
	!!(globalThis as any).browser && !!(browserAPI as any).sidebarAction;

if (isFirefox) {
	// Firefox needs an `action` key in manifest.json
	browserAPI.action?.onClicked.addListener(() => {
		// Use open(), not toggle() - toggle() doesn't exist in Firefox
		(browserAPI as any).sidebarAction.open();
	});
} else {
	// Chrome needs a side panel declared in the manifest
	browserAPI.action.onClicked.addListener((tab: chrome.tabs.Tab) => {
		if (tab.id && (browserAPI as any).sidePanel?.open) {
			(browserAPI as any).sidePanel.open({ tabId: tab.id });
		}
	});
}

export {};
