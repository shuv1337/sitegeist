import type { LockedSessionsMessage, LockResultMessage, SidepanelToBackgroundMessage } from "./utils/port.js";

// Called when Sitegeist icon is clicked - opens sidepanel for current tab
chrome.action.onClicked.addListener((tab: chrome.tabs.Tab) => {
	const tabId = tab?.id;
	if (tabId && chrome.sidePanel.open) {
		chrome.sidePanel.open({ tabId });
	}
});

// Storage keys for tracking state (persists across service worker sleep)
const SIDEPANEL_OPEN_KEY = "sidepanel_open_windows";
const SESSION_LOCKS_KEY = "session_locks"; // sessionId -> windowId mapping

// Synchronously readable cache of which sidepanels are open
// Gets populated on startup and updated by port events
let openSidepanels = new Set<number>();

// Initialize cache from storage on startup
chrome.storage.session.get(SIDEPANEL_OPEN_KEY, (data) => {
	openSidepanels = new Set<number>(data[SIDEPANEL_OPEN_KEY] || []);
	console.log("[Background] Initialized openSidepanels cache:", Array.from(openSidepanels));
});

// Handle port connections from sidepanels
chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
	// Port name format: "sidepanel:${windowId}"
	const match = /^sidepanel:(\d+)$/.exec(port.name);
	if (!match) return;

	const windowId = Number(match[1]);

	// Update cache synchronously
	openSidepanels.add(windowId);

	// Mark sidepanel as open in persistent storage (survives service worker sleep)
	chrome.storage.session.get(SIDEPANEL_OPEN_KEY, (data) => {
		const openWindows = new Set<number>(data[SIDEPANEL_OPEN_KEY] || []);
		openWindows.add(windowId);
		chrome.storage.session.set({ [SIDEPANEL_OPEN_KEY]: Array.from(openWindows) });
	});

	port.onMessage.addListener((msg: SidepanelToBackgroundMessage) => {
		if (msg.type === "acquireLock") {
			const { sessionId, windowId: reqWindowId } = msg;

			// Read current locks from persistent storage
			chrome.storage.session.get(SESSION_LOCKS_KEY, (data) => {
				const sessionLocks: Record<string, number> = data[SESSION_LOCKS_KEY] || {};
				const ownerWindowId = sessionLocks[sessionId];
				const ownerSidepanelOpen = ownerWindowId !== undefined && openSidepanels.has(ownerWindowId);

				// Grant lock if: no owner, owner sidepanel closed, or requesting window is owner
				const success = !ownerWindowId || !ownerSidepanelOpen || ownerWindowId === reqWindowId;

				const response: LockResultMessage = success
					? {
							type: "lockResult",
							sessionId,
							success: true,
						}
					: {
							type: "lockResult",
							sessionId,
							success: false,
							ownerWindowId,
						};

				if (success) {
					// Update locks in storage
					sessionLocks[sessionId] = reqWindowId;
					chrome.storage.session.set({ [SESSION_LOCKS_KEY]: sessionLocks });
				}

				port.postMessage(response);
			});
		} else if (msg.type === "getLockedSessions") {
			// Read current locks from persistent storage
			chrome.storage.session.get(SESSION_LOCKS_KEY, (data) => {
				const locks: Record<string, number> = data[SESSION_LOCKS_KEY] || {};
				const response: LockedSessionsMessage = {
					type: "lockedSessions",
					locks,
				};
				port.postMessage(response);
			});
		}
	});

	port.onDisconnect.addListener(() => {
		closeSidepanel(windowId, false);
	});
});

// Clean up locks when entire window closes (belt-and-suspenders)
chrome.windows.onRemoved.addListener((windowId: number) => {
	closeSidepanel(windowId, false);
});

// Handle keyboard shortcut - toggle sidepanel open/close
chrome.commands.onCommand.addListener((command: string, sender?: chrome.tabs.Tab) => {
	if (command === "toggle-sidepanel") {
		if (!sender?.windowId) {
			console.log("[Background] Cannot toggle sidepanel: sender windowId not available");
			return;
		}

		const windowId = sender.windowId;

		// Check synchronous cache (populated from storage on startup and updated by port events)
		if (openSidepanels.has(windowId)) {
			// Sidepanel is open - close it using Chrome 141+ API
			closeSidepanel(windowId);
		} else {
			// Sidepanel is closed - open it
			chrome.sidePanel.open({ windowId });
		}
	}
});

function closeSidepanel(windowId: number, callCloseOnSidePanelAPI: boolean = true) {
	if (callCloseOnSidePanelAPI) {
		// @ts-expect-error 'close' may be missing in some type definitions
		chrome.sidePanel.close({ windowId });
	}

	// Update cache synchronously
	openSidepanels.delete(windowId);

	// Clean up storage state (same logic as onDisconnect)
	chrome.storage.session.get([SESSION_LOCKS_KEY, SIDEPANEL_OPEN_KEY], (data) => {
		// Release session locks for this window
		const sessionLocks: Record<string, number> = data[SESSION_LOCKS_KEY] || {};
		for (const sessionId in sessionLocks) {
			if (sessionLocks[sessionId] === windowId) {
				delete sessionLocks[sessionId];
			}
		}

		// Mark sidepanel as closed
		const openWindows = new Set<number>(data[SIDEPANEL_OPEN_KEY] || []);
		openWindows.delete(windowId);

		// Save both updates atomically
		chrome.storage.session.set({
			[SESSION_LOCKS_KEY]: sessionLocks,
			[SIDEPANEL_OPEN_KEY]: Array.from(openWindows),
		});
	});
}
