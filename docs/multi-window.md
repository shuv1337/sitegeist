# Multi-Window Session Management

## Overview

Shuvgeist implements window-scoped session locking using Chrome's port API to prevent the same session from being open in multiple windows simultaneously. Each session can only be active in one window at a time.

## Behavior

### Opening Sidepanels

**First Window** (Cmd+Shift+S on Mac, Ctrl+Shift+S on Windows/Linux):
- Opens sidepanel
- Automatically loads last active session
- Session is locked to this window
- Navigation events from tabs in this window are tracked

**Second Window** (Cmd+Shift+S on Mac, Ctrl+Shift+S on Windows/Linux):
- Opens sidepanel
- Last session is locked → shows landing page with welcome message
- Can create new session or select different session from history

**Keyboard Shortcut** (Cmd+Shift+S on Mac, Ctrl+Shift+S on Windows/Linux):
- When sidepanel closed → opens it
- When sidepanel open → closes it
- Works independently per window

### Session List Dialog

Sessions display visual status:
- **Current** badge (blue): Session active in current window
- **Locked** badge (red): Session active in another window (not selectable)
- Locked sessions are dimmed and non-clickable

### Automatic Lock Release

Locks are automatically released when:
- Sidepanel closes (X button click)
- Window closes
- Page navigates (session switch, Cmd+U to debug page)
- Sidepanel crashes
- Extension reloads

No manual cleanup code needed - port disconnect handles everything.

## Architecture

### Port-Based Communication

Uses `chrome.runtime.connect()` for reliable lifecycle tracking. Port disconnects automatically trigger lock cleanup.

**Why Ports vs Messages**:
- `runtime.sendMessage()`: One-shot, unreliable in `beforeunload`
- `runtime.connect()`: Long-lived, `onDisconnect` fires reliably on page unload

### Components

#### Background Service Worker ([background.ts](../src/background.ts))

Manages session locks and port connections. See implementation for details.

**Key responsibilities**:
- **State**: Uses `chrome.storage.session` for persistent state (survives service worker sleep):
  - `session_locks`: sessionId → windowId mapping
  - `sidepanel_open_windows`: array of windowIds with open sidepanels
  - `openSidepanels`: In-memory Set (windowId) initialized from storage on startup, updated synchronously on port events
- **Initialization**: Populates `openSidepanels` cache from storage when service worker starts
- **Port handler**: Listens for connections with name format `sidepanel:${windowId}`
  - Updates cache and marks sidepanel as open in storage on connect
  - `acquireLock` message: Reads locks from storage, grants if available or owner sidepanel is closed
  - `getLockedSessions` message: Reads locks from storage for session list UI
  - `onDisconnect`: Updates cache, releases all locks, and marks sidepanel closed in storage
- **Window cleanup**: Belt-and-suspenders cleanup when entire window closes (same logic as onDisconnect)
- **Keyboard shortcut**: Checks synchronous `openSidepanels` cache to maintain user gesture context, toggles open/close using `chrome.sidePanel.close()` (Chrome 141+)

#### Port Module ([utils/port.ts](../src/utils/port.ts))

Centralized port communication with automatic reconnection and type-safe messaging. See implementation for details.

**Key features**:
- **Initialization**: `initialize(windowId)` - must be called before sending messages
- **Auto-reconnection**: 2-attempt retry with automatic reconnect on failure or ~5min inactivity timeout
- **Type-safe messaging**: `sendMessage<TRequest>` infers response type from request type
- **Message routing**: Dispatches responses to registered handlers
- **Connection management**: Creates port with name `sidepanel:${windowId}`, listens for disconnect

#### Sidepanel ([sidepanel.ts](../src/sidepanel.ts))

Uses port module for session locking and tracks window-specific events. See implementation for details.

**Key behaviors**:
- **Port init**: Calls `port.initialize(currentWindowId)` during app startup
- **Lock on init**: Tries to acquire lock for latest session, shows landing page if locked
- **Lock on session creation**: Acquires lock when first message creates a sessionId
- **Window filtering**: Only tracks tab navigation/activation in current window
- **No manual cleanup**: Port disconnect automatically releases locks on navigation/close

#### Session List Dialog ([dialogs/SessionListDialog.ts](../src/dialogs/SessionListDialog.ts))

Displays session list with Current/Locked badges. See implementation for details.

**Key features**:
- **Lock query**: Uses `port.sendMessage({ type: "getLockedSessions" })` to fetch all locks
- **Badge logic**: `isSessionLocked()` and `isCurrentSession()` determine badge display
- **UI rendering**: Locked sessions are dimmed and non-clickable, current session highlighted

## Technical Details

### Port Lifecycle

**Port Creation**: `runtime.connect({ name: "sidepanel:${windowId}" })`
**Port Disconnect**: Fires when page unloads for ANY reason:
- Manual close (X button)
- Window close
- Navigation (`window.location.href`)
- Crash
- Extension reload

**Reliability**: Chrome guarantees `onDisconnect` fires - official API for tracking page lifecycle

### Stale Lock Detection

Background checks if lock owner's sidepanel is still open using the `openSidepanels` cache before denying lock request. If owner sidepanel is closed (stale lock), lock is reassigned to requester.

**Storage-based state** survives service worker sleep, preventing lock loss during normal operation. The `openSidepanels` cache is rebuilt from storage on service worker startup and kept synchronized via port events.

### Session Storage-Based Locks

**Why**: Service workers go to sleep after ~30 seconds in Manifest V3. In-memory state is lost, breaking:
- Session locks (allowing same session in multiple windows)
- Keyboard shortcut toggle (always thinks sidepanel is closed)

**Solution**: Dual-layer state management:
- **Persistent layer**: `chrome.storage.session` persists across service worker sleep/wake cycles, automatically cleared on browser restart (prevents permanent stale locks)
- **Synchronous layer**: `openSidepanels` in-memory Set initialized from storage on startup, updated synchronously on port events
- **User gesture compatibility**: Keyboard shortcut checks synchronous cache to maintain user gesture context (required by `chrome.sidePanel.open()`)
- **Chrome 141+ API**: Uses `chrome.sidePanel.close()` for programmatic sidepanel closing

Port module still handles automatic reconnection after ~5min Chrome inactivity timeout (2-attempt retry logic).

## Test Scenarios

1. **Basic Isolation**
   - Window A: Open sidepanel (Cmd+Shift+S) → session loads
   - Window B: Open sidepanel → landing page (session locked)
   - Navigate in Window A tabs → only Window A sees events
   - Navigate in Window B tabs → no effect on Window A

2. **New Session Lock**
   - Window A: Create new session, send first message
   - Window A: Wait for response (sessionId assigned, lock acquired)
   - Window B: Open sidepanel → landing page (Window A's session locked)
   - Window B: Session list → Window A's session shows "Locked" badge

3. **Lock Badges**
   - Window A: Open session list → session has "Current" badge
   - Window B: Open session list → same session has "Locked" badge, not clickable

4. **Session Switching**
   - Window A: Switch to different session
   - Window B: Session list → original session now selectable (lock released)

5. **Sidepanel Close**
   - Window A: Close sidepanel with X button
   - Window B: Open sidepanel → session loads (lock released)

6. **Window Close**
   - Window A: Close entire window
   - Window B: Session now available (lock released)

7. **Keyboard Toggle**
   - Sidepanel open: Cmd+Shift+S → closes
   - Sidepanel closed: Cmd+Shift+S → opens
   - Independent per window

8. **Navigation**
   - Cmd+U to debug page → locks released
   - Session switch → locks released
   - All handled by port disconnect

## Edge Cases

### Service Worker Sleep
**Scenario**: Background service worker goes inactive after ~30 seconds
**Impact**: In-memory state lost (NOT prevented by ports in Manifest V3)
**Resolution**: All state stored in `chrome.storage.session` which persists across service worker lifecycle. Keyboard shortcut and session locks work correctly after sleep.

### Extension Reload
**Scenario**: User reloads extension
**Impact**: All locks cleared, all ports disconnected
**Resolution**: Intentional - prevents stale locks. Users can reopen any session.

### Crashed Sidepanel
**Scenario**: Sidepanel crashes without closing gracefully
**Impact**: Port disconnects
**Resolution**: Lock automatically released via `onDisconnect`

### Direct URL Navigation
**Scenario**: User manually types `?session=123` in URL
**Impact**: Triggers lock acquisition check
**Resolution**: Shows landing page if session is locked, loads if available

## Related Files

**Core Implementation**:
- [background.ts](../src/background.ts) - Port handler, lock manager, keyboard shortcut toggle, window close cleanup
- [utils/port.ts](../src/utils/port.ts) - Centralized port communication with automatic reconnection, type-safe message handling
- [sidepanel.ts](../src/sidepanel.ts) - Port initialization, window ID filtering, lock acquisition on init and session creation

**UI Components**:
- [dialogs/SessionListDialog.ts](../src/dialogs/SessionListDialog.ts) - Lock badges UI (Current/Locked), lock state querying
- [utils/i18n-extension.ts](../src/utils/i18n-extension.ts) - "Current" and "Locked" translations

**Configuration**:
- [static/manifest.chrome.json](../static/manifest.chrome.json) - Chrome keyboard shortcut: "toggle-sidepanel" with Cmd+Shift+S (Mac) / Ctrl+Shift+S (Windows/Linux)
