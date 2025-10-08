# Memory API for Browser JavaScript Tool

## Overview

The Memory API provides **session-scoped persistent storage** for the browser_javascript tool, allowing the AI model to store and retrieve data across page navigations within the same conversation session.

## The Problem

When the model needs to collect data from multiple pages (e.g., "fetch all video transcripts from this playlist"), it faces a challenge:

1. Navigate to page 1, extract data
2. Navigate to page 2 → **execution context destroyed, data lost!**
3. Navigate to page 3 → no way to access data from pages 1 & 2

Traditional solutions don't work:
- `localStorage` pollutes the website's storage and persists beyond the session
- `sessionStorage` is tied to the tab and can cause issues
- Extension APIs like `chrome.storage` are not accessible from user scripts

## The Solution: Memory API

A session-scoped storage API that:
- **Persists across navigations** within the same conversation
- **Is isolated per session** (different conversations don't interfere)
- **Uses IndexedDB** to handle potentially large datasets
- **Automatically serializes/deserializes** JSON for convenience

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                        User Script                          │
│                    (USER_SCRIPT world)                      │
│                                                             │
│  const products = await memory.get('products') || [];       │
│  products.push(newProduct);                                 │
│  await memory.set('products', products);                    │
│             ↓                                               │
│  chrome.runtime.sendMessage({                               │
│    type: 'memory_set',                                      │
│    key: 'products',                                         │
│    value: JSON.stringify(products)                          │
│  })                                                         │
└─────────────────────────────────────────────────────────────┘
                              ↓
                    chrome.runtime.sendMessage
                              ↓
┌─────────────────────────────────────────────────────────────┐
│          browser-javascript.ts (Sitegeist Extension)        │
│                                                             │
│  chrome.runtime.onMessage.addListener((msg, sender, reply) │
│    if (msg.type === 'memory_set') {                        │
│      const sessionId = getCurrentSessionId()                │
│      const memories = getSitegeistStorage().memories        │
│      await memories.set(sessionId, msg.key, msg.value)      │
│      reply({ success: true })                               │
│    }                                                        │
│  })                                                         │
└─────────────────────────────────────────────────────────────┘
                              ↓
                    MemoriesRepository
                              ↓
                   MemoriesIndexedDBBackend
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                        IndexedDB                            │
│                    (sitegeist-memories)                     │
│                                                             │
│  Object Store: memories                                     │
│  Key: `${sessionId}_${key}`                                 │
│  Value: JSON.stringify(data)                                │
│                                                             │
│  - Handles large datasets (GB range)                        │
│  - Persists across navigations and browser restarts         │
│  - Scoped to session                                        │
└─────────────────────────────────────────────────────────────┘
```

### File Structure

**Sitegeist Extension (where memories live):**
- `src/storage/memories-repository.ts` - MemoriesRepository class
- `src/storage/memories-indexeddb-backend.ts` - MemoriesIndexedDBBackend class
- `src/storage/app-storage.ts` - Extends web-ui AppStorage, adds `memories` field
- `src/tools/browser-javascript.ts` - Message handlers for memory operations

**Web-UI (shared infrastructure, no memory awareness):**
- `src/storage/repositories/session-repository.ts` - Session management (we DON'T modify this)
- `src/storage/backends/session-indexeddb-backend.ts` - Generic IndexedDB backend pattern (reference for implementation)
- `src/storage/app-storage.ts` - Base AppStorage interface
- `src/tools/javascript-repl.ts` - Doesn't use memories (demo/test tool)

**Why separate?**
- Memories are **sitegeist-specific** (browser extension feature)
- javascript-repl.ts runs in web-ui context and doesn't need memories
- Keeps web-ui generic and reusable
- Follows existing pattern: sitegeist extends web-ui's AppStorage with `skills`, now also `memories`

### Session ID

The session ID uniquely identifies a conversation and is used to namespace all memory operations.

**Where it comes from:**
- Passed as a query parameter when the sidepanel opens (e.g., `?session=abc123`)
- Available in the extension context (sidepanel, tool execution)
- **NOT** available in user scripts (they're isolated)

**How it's used:**
- All memory keys are prefixed with session ID: `${sessionId}_${userKey}`
- Ensures different conversations have isolated memory spaces
- Allows cleanup when session is deleted by the user

**Implementation:**
```typescript
// In src/tools/browser-javascript.ts
function getCurrentSessionId(): string {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session');

  if (!sessionId) {
    throw new Error('Session ID not available - sidepanel must be opened with ?session=<id>');
  }

  return sessionId;
}
```

### MemoriesRepository

**File:** `src/storage/memories-repository.ts`

A repository class that manages session-scoped memory in IndexedDB.

**Interface:**
```typescript
import type { MemoriesIndexedDBBackend } from "./memories-indexeddb-backend.js";

export class MemoriesRepository {
  constructor(private backend: MemoriesIndexedDBBackend) {}

  // Basic operations
  async set(sessionId: string, key: string, value: string): Promise<void> {
    await this.backend.set(`${sessionId}_${key}`, value);
  }

  async get(sessionId: string, key: string): Promise<string | undefined> {
    return await this.backend.get(`${sessionId}_${key}`);
  }

  async has(sessionId: string, key: string): Promise<boolean> {
    const value = await this.backend.get(`${sessionId}_${key}`);
    return value !== undefined;
  }

  async delete(sessionId: string, key: string): Promise<void> {
    await this.backend.delete(`${sessionId}_${key}`);
  }

  // Efficient session-scoped operations using IDBKeyRange
  async clear(sessionId: string): Promise<void> {
    // Use backend's efficient deleteRange method
    await this.backend.deleteRange(sessionId);
  }

  async keys(sessionId: string): Promise<string[]> {
    // Use backend's efficient getKeysInRange method
    const sessionKeys = await this.backend.getKeysInRange(sessionId);
    // Return just the user keys (without session prefix)
    return sessionKeys.map(k => k.substring(sessionId.length + 1));
  }
}
```

### MemoriesIndexedDBBackend

**File:** `src/storage/memories-indexeddb-backend.ts`

IndexedDB backend specifically for memories storage.

**Reference:** Look at `@mariozechner/pi-web-ui/src/storage/backends/session-indexeddb-backend.ts` for implementation pattern.

```typescript
import type { StorageBackend } from "@mariozechner/pi-web-ui";

export class MemoriesIndexedDBBackend implements StorageBackend {
  private db: IDBDatabase | null = null;
  private readonly dbName = 'sitegeist-memories';
  private readonly storeName = 'memories';

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
    });
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async set<T>(key: string, value: T): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(value, key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async delete(key: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async keys(): Promise<string[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAllKeys();

      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(request.error);
    });
  }

  // Efficient session-scoped operations using IDBKeyRange
  async getKeysInRange(sessionId: string): Promise<string[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);

      // Create range for all keys starting with sessionId
      const range = IDBKeyRange.bound(
        `${sessionId}_`,
        `${sessionId}_\uffff`  // \uffff is highest Unicode character
      );

      const request = store.getAllKeys(range);

      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteRange(sessionId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);

      // Create range for all keys starting with sessionId
      const range = IDBKeyRange.bound(
        `${sessionId}_`,
        `${sessionId}_\uffff`
      );

      // Wait for transaction to complete
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      // Use cursor to delete all matching keys in single transaction
      const request = store.openCursor(range);

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
        // Don't resolve here - wait for transaction.oncomplete
      };

      request.onerror = () => reject(request.error);
    });
  }
}
```

### AppStorage Integration

**File:** `src/storage/app-storage.ts`

Extend web-ui's AppStorage to add memories repository.

```typescript
import { getAppStorage, type AppStorage } from "@mariozechner/pi-web-ui";
import { SkillsRepository } from "./skills-repository.js";
import { MemoriesRepository } from "./memories-repository.js";
import { MemoriesIndexedDBBackend } from "./memories-indexeddb-backend.js";

export interface SitegeistStorage extends AppStorage {
  skills: SkillsRepository;
  memories: MemoriesRepository;
}

let storage: SitegeistStorage | null = null;

export async function initSitegeistStorage(): Promise<SitegeistStorage> {
  const baseStorage = await getAppStorage();
  const backend = baseStorage.backend;

  // Initialize memories backend
  const memoriesBackend = new MemoriesIndexedDBBackend();
  await memoriesBackend.init();

  storage = {
    ...baseStorage,
    skills: new SkillsRepository(backend),
    memories: new MemoriesRepository(memoriesBackend),
  };

  return storage;
}

export function getSitegeistStorage(): SitegeistStorage {
  if (!storage) {
    throw new Error("Storage not initialized. Call initSitegeistStorage() first.");
  }
  return storage;
}
```

**Usage in sidepanel initialization:**
```typescript
// In src/sidepanel.ts (or wherever sidepanel initializes)
await initSitegeistStorage();
```

### Message Protocol

User scripts communicate with the extension via `chrome.runtime.sendMessage()`.

**Message Types:**

```typescript
// Set a value (stringified JSON)
{ type: 'memory_set', key: string, value: string }
// Response: { success: boolean }

// Get a value (stringified JSON)
{ type: 'memory_get', key: string }
// Response: { value?: string }

// Check if key exists
{ type: 'memory_has', key: string }
// Response: { exists: boolean }

// Remove a key
{ type: 'memory_delete', key: string }
// Response: { success: boolean }

// Clear all memory for this session
{ type: 'memory_clear' }
// Response: { success: boolean }

// Get all keys for this session
{ type: 'memory_keys' }
// Response: { keys: string[] }
```

### Message Handler Registration

**File:** `src/tools/browser-javascript.ts`

Add message listener for memory operations. This should be registered when the tool is loaded/initialized.

```typescript
import { getSitegeistStorage } from "../storage/app-storage.js";

// Register message handler (call this during tool initialization)
function registerMemoryMessageHandler() {
  // Cross-browser API
  // @ts-expect-error
  const browser = globalThis.browser || globalThis.chrome;

  browser.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
    // Only handle memory messages
    if (!message.type?.startsWith('memory_')) {
      return; // Let other handlers process this
    }

    const sessionId = getCurrentSessionId();
    const memories = getSitegeistStorage().memories;

    (async () => {
      try {
        switch (message.type) {
          case 'memory_set':
            await memories.set(sessionId, message.key, message.value);
            sendResponse({ success: true });
            break;

          case 'memory_get':
            const value = await memories.get(sessionId, message.key);
            sendResponse({ value });
            break;

          case 'memory_has':
            const exists = await memories.has(sessionId, message.key);
            sendResponse({ exists });
            break;

          case 'memory_delete':
            await memories.delete(sessionId, message.key);
            sendResponse({ success: true });
            break;

          case 'memory_clear':
            await memories.clear(sessionId);
            sendResponse({ success: true });
            break;

          case 'memory_keys':
            const keys = await memories.keys(sessionId);
            sendResponse({ keys });
            break;

          default:
            sendResponse({ error: 'Unknown memory operation' });
        }
      } catch (error: any) {
        sendResponse({ error: error.message });
      }
    })();

    return true; // Keep message channel open for async response
  });
}

function getCurrentSessionId(): string {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session');

  if (!sessionId) {
    throw new Error('Session ID not available');
  }

  return sessionId;
}

// Call during module initialization
registerMemoryMessageHandler();
```

### User Script API

**File:** `src/tools/browser-javascript.ts` (wrapperFunction)

The `memory` object exposed to user scripts provides a simple 6-method API with automatic JSON serialization.

**Implementation in wrapperFunction:**
```javascript
// Create memory object for persisting data across navigations
// @ts-expect-error - chrome global is injected
const chromeAPI = typeof chrome !== "undefined" ? chrome : null;

(window as any).memory = {
  async set(key: string, value: any): Promise<void> {
    if (!chromeAPI?.runtime) throw new Error("memory API requires extension context");
    const stringified = JSON.stringify(value);
    const response = await chromeAPI.runtime.sendMessage({
      type: 'memory_set',
      key,
      value: stringified
    });
    if (response?.error) throw new Error(response.error);
  },

  async get(key: string): Promise<any> {
    if (!chromeAPI?.runtime) throw new Error("memory API requires extension context");
    const response = await chromeAPI.runtime.sendMessage({
      type: 'memory_get',
      key
    });
    if (response?.error) throw new Error(response.error);
    return response?.value ? JSON.parse(response.value) : undefined;
  },

  async has(key: string): Promise<boolean> {
    if (!chromeAPI?.runtime) throw new Error("memory API requires extension context");
    const response = await chromeAPI.runtime.sendMessage({
      type: 'memory_has',
      key
    });
    if (response?.error) throw new Error(response.error);
    return response?.exists || false;
  },

  async delete(key: string): Promise<void> {
    if (!chromeAPI?.runtime) throw new Error("memory API requires extension context");
    const response = await chromeAPI.runtime.sendMessage({
      type: 'memory_delete',
      key
    });
    if (response?.error) throw new Error(response.error);
  },

  async clear(): Promise<void> {
    if (!chromeAPI?.runtime) throw new Error("memory API requires extension context");
    const response = await chromeAPI.runtime.sendMessage({
      type: 'memory_clear'
    });
    if (response?.error) throw new Error(response.error);
  },

  async keys(): Promise<string[]> {
    if (!chromeAPI?.runtime) throw new Error("memory API requires extension context");
    const response = await chromeAPI.runtime.sendMessage({
      type: 'memory_keys'
    });
    if (response?.error) throw new Error(response.error);
    return response?.keys || [];
  },
};
```

**API exposed to user scripts:**
```javascript
await memory.set(key, value)      // Store any value (auto JSON.stringify)
await memory.get(key)             // Retrieve value (auto JSON.parse, undefined if missing)
await memory.has(key)             // Check if key exists
await memory.delete(key)          // Remove key
await memory.clear()              // Clear all memory for this session
await memory.keys()               // Get array of all keys
```

## Usage Patterns

### Pattern 1: Collecting Items Across Pages

**Scenario:** Fetch transcripts from all videos in a YouTube playlist.

```javascript
// Page 1 - First video
const transcripts = await memory.get('transcripts') || [];
transcripts.push({
  title: document.title,
  url: location.href,
  transcript: extractTranscript()
});
await memory.set('transcripts', transcripts);

// Navigate to next video
location.href = nextVideoUrl;

// Page 2 - Second video (new execution context!)
const transcripts = await memory.get('transcripts') || [];
transcripts.push({
  title: document.title,
  url: location.href,
  transcript: extractTranscript()
});
await memory.set('transcripts', transcripts);

// Continue until done...

// Final page - return all transcripts
const allTranscripts = await memory.get('transcripts');
return allTranscripts;
```

### Pattern 2: Tracking Progress Through Multi-Step Task

**Scenario:** Scrape product details from paginated search results.

```javascript
// Get current state or initialize
const state = await memory.get('scraping_state') || { page: 1, products: [] };

// Extract products from current page
const products = Array.from(document.querySelectorAll('.product')).map(el => ({
  name: el.querySelector('.name').textContent,
  price: el.querySelector('.price').textContent,
}));

// Update state
state.products.push(...products);
state.page++;

// Save state
await memory.set('scraping_state', state);

// Navigate to next page if more exist
if (hasNextPage()) {
  location.href = getNextPageUrl();
} else {
  // Done - return all products
  return state.products;
}
```

### Pattern 3: Storing Session-Specific Configuration

**Scenario:** User asks to scrape with specific filters that should persist across pages.

```javascript
// First call - set filters
await memory.set('filters', {
  minPrice: 100,
  category: 'electronics',
  inStock: true
});

// Later navigations - use filters
const filters = await memory.get('filters');
const products = Array.from(document.querySelectorAll('.product'))
  .filter(el => {
    const price = parseFloat(el.querySelector('.price').textContent);
    const category = el.getAttribute('data-category');
    return price >= filters.minPrice && category === filters.category;
  });
```

## Session Lifecycle Integration

Memories are part of a session's lifecycle and must be deleted when the session is deleted.

**Where to integrate:**

Wherever sessions are deleted (session repository, user action, etc.), add memory cleanup:

```typescript
// In session deletion handler
async function deleteSession(sessionId: string) {
  const storage = getSitegeistStorage();

  // Delete session data (chat history, model state, etc.)
  await storage.sessions.delete(sessionId);

  // Delete all memories for this session
  await storage.memories.clear(sessionId);
}
```

**Performance:**
- Uses efficient `IDBKeyRange` to find only keys for this session
- Deletes all matching keys in single transaction via cursor
- Scales well even with thousands of memory entries per session

**No separate cleanup needed:**
- Memories don't need periodic cleanup - they're tied to session lifecycle
- When session is deleted, memories are deleted
- Session IDs are UUIDs, so no timestamp-based cleanup

## Tool Description

**File:** `src/tools/browser-javascript.ts` (description field)

Concise, accurate description focusing on what the model needs to know.

```markdown
Execute JavaScript code in the context of the active browser tab to interact with web pages.

**What you can do:**
- Access and manipulate the page DOM (document, window, all elements)
- Read and modify page content, styles, and structure
- Use console.log() for output (captured and returned)
- Return values using explicit return statement

**What you CANNOT do:**
- Access page JavaScript variables or functions (runs in isolated USER_SCRIPT world)
- Call page framework methods (React, Vue, etc.) - they're in a different context
- Access or modify page's global variables

**Skills - Reusable Functions:**
Skills are domain-specific JavaScript libraries automatically injected when visiting matching sites.
If a skill exists for the current domain, its functions are available in the global scope.
Example: On Gmail, a `gmail` skill might provide `gmail.sendEmail()`, `gmail.listInbox()`, etc.
Check for available skills before writing DOM manipulation code - they save tokens!

**Memory - Persist Data Across Navigation:**
When navigating between pages (location.href=, history.back(), etc.), the execution context is destroyed.
Use the `memory` object to persist data across navigations within the same session:

- `await memory.set(key, value)` - Store any value (auto JSON serialized)
- `await memory.get(key)` - Retrieve value (returns undefined if missing)
- `await memory.has(key)`, `await memory.delete(key)`, `await memory.clear()`, `await memory.keys()`

Example - Multi-page data collection:
```javascript
// Tool call 1: Extract and save data
const items = await memory.get('items') || [];
items.push(extractData());
await memory.set('items', items);
return 'Saved item, ready to navigate';

// Tool call 2: Navigate (separate call!)
location.href = nextPageUrl;

// Tool call 3: After navigation, continue collecting
const items = await memory.get('items') || [];
items.push(extractData());
await memory.set('items', items);
```

**Security restrictions:**
- Cannot access localStorage, sessionStorage, cookies, or IndexedDB
- Cannot use fetch(), XMLHttpRequest, WebSocket (no network requests)
- Cannot inject scripts or create iframes
- Code runs in an isolated execution world for security

**Navigation:**
Navigation commands (location.href=, history.back/forward/go) destroy the execution context.
CRITICAL: Navigation MUST be in its own separate tool call with ONLY the navigation command.

Example:
```javascript
// Tool call 1: Save data
await memory.set('items', items);

// Tool call 2: ONLY navigation (nothing else!)
location.href = nextUrl;

// Tool call 3: After navigation completes, continue
const items = await memory.get('items');
```

Never put navigation in the same tool call as other code - it will destroy the execution context mid-execution!

**Important:**
- Always save to memory BEFORE navigating
- Load from memory AFTER navigation
- Use return statement to capture final values
- Only works on http/https pages (not chrome://, about:, etc.)
```

## System Prompt Updates

Add trigger patterns to help the model recognize when to use memory:

```markdown
**Memory API Recognition:**

When you see these patterns, automatically use the memory API:

🔴 **High-confidence triggers:**
- "fetch/get/collect [items] from each/all [pages]"
- "extract transcripts from all videos"
- "scrape products from all search results"
- Any task involving navigation + data aggregation

🟡 **Medium-confidence triggers:**
- Plural data requests ("all", "every", "each")
- Pagination words ("next page", "page 2", "all pages")
- List/collection words ("list of", "collection of", "all [X]")

🟢 **Pattern to use:**
```javascript
// Tool call 1: Get, append, save
const items = await memory.get('items') || [];
items.push(currentPageData);
await memory.set('items', items);

// Tool call 2: Navigate (separate call!)
location.href = nextUrl;

// Tool call 3: After navigation, get and continue
const items = await memory.get('items') || [];
// ... collect more, append, save, navigate again
```

**Anti-pattern (DON'T DO THIS):**
```javascript
// ❌ Will lose data on navigation!
const results = [];
results.push(page1Data);
location.href = page2;  // results array is GONE
```
```

## Security Considerations

1. **Isolation**: Memory is scoped to session ID, preventing cross-session data leakage
2. **Extension-only storage**: User scripts cannot directly access IndexedDB or chrome.storage
3. **Message validation**: All messages must be validated before processing
4. **Size limits**: Consider implementing per-session quotas to prevent abuse
5. **Sensitive data**: Memory is persistent - avoid storing sensitive information

## Future Enhancements

1. **TTL (Time To Live)**: Auto-expire memory entries after N hours
2. **Compression**: Compress large values before storage
3. **Transactions**: Atomic multi-key operations
4. **Export/Import**: Allow user to save/restore memory state
5. **Debugging**: UI to inspect current session memory
6. **Quotas**: Per-session size limits with warnings

## Implementation Checklist

- [ ] Create `src/storage/memories-indexeddb-backend.ts`
- [ ] Create `src/storage/memories-repository.ts`
- [ ] Update `src/storage/app-storage.ts` to add `memories` field
- [ ] Update `src/sidepanel.ts` to call `initSitegeistStorage()`
- [ ] Update `src/tools/browser-javascript.ts`:
  - [ ] Add memory object to wrapperFunction
  - [ ] Add registerMemoryMessageHandler()
  - [ ] Add getCurrentSessionId() helper
  - [ ] Update tool description with new concise version
  - [ ] Update cleanup to remove memory object
  - [ ] Remove returnFile functionality
  - [ ] Remove BrowserJavaScriptToolResult files field
- [ ] Update system prompt (location TBD) with Memory API recognition patterns
- [ ] Test multi-page navigation scenario
- [ ] Implement cleanup on session end
