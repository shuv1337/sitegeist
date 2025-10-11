// Cross-browser API compatibility
// @ts-expect-error - browser global exists in Firefox, chrome in Chrome
const browserAPI: typeof chrome & typeof browser =
	(globalThis as any).browser || (globalThis as any).chrome;

const isFirefox =
	!!(globalThis as any).browser && !!(browserAPI as any).sidebarAction;

function toggleSidePanel(tab?: chrome.tabs.Tab) {
	if (isFirefox) {
		// Use open(), not toggle() - toggle() doesn't exist in Firefox
		(browserAPI as any).sidebarAction.open();
	} else {
		// Chrome needs a side panel declared in the manifest
		const tabId = tab?.id;
		if (tabId && (browserAPI as any).sidePanel?.open) {
			(browserAPI as any).sidePanel.open({ tabId });
		}
	}
}

if (isFirefox) {
	// Firefox needs an `action` key in manifest.json
	browserAPI.action?.onClicked.addListener(() => {
		toggleSidePanel();
	});
} else {
	// Chrome needs a side panel declared in the manifest
	browserAPI.action.onClicked.addListener((tab: chrome.tabs.Tab) => {
		toggleSidePanel(tab);
	});
}

// Track if sidepanel is open (Chrome only - Firefox handles this differently)
let sidePanelOpen = false;

// Handle keyboard shortcut
browserAPI.commands?.onCommand.addListener(async (command: string) => {
	if (command === "toggle-sidepanel") {
		if (isFirefox) {
			// Firefox: just toggle the sidebar
			toggleSidePanel();
		} else {
			// Chrome: check if sidepanel is open and close it, or open it
			if (sidePanelOpen) {
				// Send message to sidepanel to close itself
				try {
					await browserAPI.runtime.sendMessage({ type: "toggle-sidepanel" });
					sidePanelOpen = false;
				} catch (_e) {
					// Sidepanel might already be closed
					sidePanelOpen = false;
				}
			} else {
				// Open the sidepanel
				browserAPI.windows.getCurrent((w: any) => {
					if (w.id && (browserAPI as any).sidePanel?.open) {
						(browserAPI as any).sidePanel.open({ windowId: w.id });
						sidePanelOpen = true;
					}
				});
			}
		}
	}
});

export {};
