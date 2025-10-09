# Runtime Bridge: Unified Provider Architecture

## Problem

Runtime providers (artifacts, attachments, console, file downloads) are currently implemented separately for each execution context:

1. **Sandbox iframe context** (`/Users/badlogic/workspaces/pi-mono/packages/web-ui/src/components/SandboxedIframe.ts`)
   - Uses `window.parent.postMessage()` for communication
   - Providers in `/Users/badlogic/workspaces/pi-mono/packages/web-ui/src/components/sandbox/`

2. **User script context** (`/Users/badlogic/workspaces/sitegeist/src/tools/browser-javascript.ts`)
   - Uses `chrome.runtime.sendMessage()` for communication
   - Duplicate implementations inline in wrapper function

Despite both contexts being **equally isolated** (USER_SCRIPT world isolation = iframe isolation), we have:
- ❌ Duplicate artifact functions (2 implementations)
- ❌ Duplicate attachment functions (2 implementations)
- ❌ Duplicate console capture (2 implementations)
- ❌ Duplicate file download (2 implementations)

Additional issues:
- ConsoleRuntimeProvider contains execution lifecycle logic (timeout, `complete()`) that should be in wrapper code
- `returnDownloadableFile()` is incorrectly placed in AttachmentsRuntimeProvider
- No offline support for downloaded HTML artifacts
- Tight coupling to specific messaging APIs

## Proposed Solution

### High-Level Architecture

Create a unified messaging abstraction (`sendRuntimeMessage()`) that allows runtime providers to be written **once** and work in **all contexts**:

1. **Extension contexts** (online):
   - Sandbox iframe: `sendRuntimeMessage()` → `window.parent.postMessage()` + promise
   - User script: `sendRuntimeMessage()` → `chrome.runtime.sendMessage()` + promise
   - Full read/write access to artifacts

2. **Offline contexts** (downloaded HTML):
   - No `sendRuntimeMessage()` injected
   - Providers detect offline mode via `!window.sendRuntimeMessage`
   - Graceful fallback to read-only snapshot data

### Key Components

**1. RuntimeMessageBridge** (new)
- Generates `sendRuntimeMessage()` function for each context
- Handles both request/response (artifacts) and fire-and-forget (console)

**2. RuntimeMessageRouter** (extended)
- Currently: `SandboxMessageRouter` handles only iframe messages
- Extended: handles both iframe AND user script messages
- Single registration point for all providers

**3. Refactored Providers**
- Use `sendRuntimeMessage()` instead of context-specific APIs
- Support offline mode via fallback to `window.artifacts`/`window.attachments`
- Clean separation of concerns (no lifecycle logic)

**4. New FileDownloadRuntimeProvider**
- Extracted from AttachmentsRuntimeProvider
- Handles only `returnDownloadableFile()`

## Implementation Plan

### Phase 1: Create Messaging Abstraction

#### 1.1 Create RuntimeMessageBridge
**File:** `/Users/badlogic/workspaces/pi-mono/packages/web-ui/src/components/sandbox/RuntimeMessageBridge.ts`

```typescript
/**
 * Generates sendRuntimeMessage() function for injection into execution contexts.
 * Provides unified messaging API that works in both sandbox iframe and user script contexts.
 */

export type MessageType = 'request-response' | 'fire-and-forget';

export interface RuntimeMessageBridgeOptions {
    context: 'sandbox-iframe' | 'user-script';
    sandboxId: string;
}

export class RuntimeMessageBridge {
    /**
     * Generate sendRuntimeMessage() function as injectable string.
     * Returns the function source code to be injected into target context.
     */
    static generateBridgeCode(options: RuntimeMessageBridgeOptions): string {
        if (options.context === 'sandbox-iframe') {
            return this.generateSandboxBridge(options.sandboxId);
        } else {
            return this.generateUserScriptBridge(options.sandboxId);
        }
    }

    private static generateSandboxBridge(sandboxId: string): string {
        // Returns stringified function that uses window.parent.postMessage
        return `
window.sendRuntimeMessage = async (message) => {
    const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

    return new Promise((resolve, reject) => {
        const handler = (e) => {
            if (e.data.type === 'runtime-response' && e.data.messageId === messageId) {
                window.removeEventListener('message', handler);
                if (e.data.success) {
                    resolve(e.data);
                } else {
                    reject(new Error(e.data.error || 'Operation failed'));
                }
            }
        };

        window.addEventListener('message', handler);

        window.parent.postMessage({
            ...message,
            sandboxId: ${JSON.stringify(sandboxId)},
            messageId: messageId
        }, '*');

        // Timeout after 30s
        setTimeout(() => {
            window.removeEventListener('message', handler);
            reject(new Error('Runtime message timeout'));
        }, 30000);
    });
};
`.trim();
    }

    private static generateUserScriptBridge(sandboxId: string): string {
        // Returns stringified function that uses chrome.runtime.sendMessage
        return `
window.sendRuntimeMessage = async (message) => {
    return await chrome.runtime.sendMessage({
        ...message,
        sandboxId: ${JSON.stringify(sandboxId)}
    });
};
`.trim();
    }
}
```

**Why:** Abstracts the difference between `window.parent.postMessage()` and `chrome.runtime.sendMessage()` behind a single API.

### Phase 2: Extend Message Router

#### 2.1 Rename and Extend SandboxMessageRouter → RuntimeMessageRouter
**File:** `/Users/badlogic/workspaces/pi-mono/packages/web-ui/src/components/sandbox/SandboxMessageRouter.ts` → `/Users/badlogic/workspaces/pi-mono/packages/web-ui/src/components/sandbox/RuntimeMessageRouter.ts`

**Changes:**

1. **Add user script message listener:**

```typescript
export class RuntimeMessageRouter {
    private sandboxes = new Map<string, SandboxContext>();
    private messageListener: ((e: MessageEvent) => void) | null = null;
    private userScriptMessageListener: ((message: any, sender: any, sendResponse: (response: any) => void) => void) | null = null;

    /**
     * Setup listeners for both sandbox iframe and user script messages
     */
    private setupListener(): void {
        // Existing sandbox iframe listener
        if (!this.messageListener) {
            this.messageListener = async (e: MessageEvent) => {
                const { sandboxId, messageId } = e.data;
                if (!sandboxId) return;

                const context = this.sandboxes.get(sandboxId);
                if (!context) return;

                const respond = (response: any) => {
                    context.iframe?.contentWindow?.postMessage({
                        type: 'runtime-response',
                        messageId,
                        sandboxId,
                        ...response
                    }, '*');
                };

                // Route to providers
                for (const provider of context.providers) {
                    if (provider.handleMessage) {
                        const handled = await provider.handleMessage(e.data, respond);
                        if (handled) return;
                    }
                }

                // Broadcast to consumers
                for (const consumer of context.consumers) {
                    const consumed = await consumer.handleMessage(e.data);
                    if (consumed) break;
                }
            };

            window.addEventListener('message', this.messageListener);
        }

        // NEW: User script message listener (with guard)
        if (!this.userScriptMessageListener) {
            // Guard: check if we're in extension context
            if (typeof chrome === 'undefined' || !chrome.runtime?.onUserScriptMessage) {
                console.log('[RuntimeMessageRouter] User script API not available (not in extension context)');
                return;
            }

            this.userScriptMessageListener = (message: any, sender: any, sendResponse: (response: any) => void) => {
                const { sandboxId } = message;
                if (!sandboxId) return false;

                const context = this.sandboxes.get(sandboxId);
                if (!context) return false;

                const respond = (response: any) => {
                    sendResponse({
                        ...response,
                        sandboxId,
                    });
                };

                // Route to providers (async)
                (async () => {
                    for (const provider of context.providers) {
                        if (provider.handleMessage) {
                            const handled = await provider.handleMessage(message, respond);
                            if (handled) return;
                        }
                    }

                    // Broadcast to consumers
                    for (const consumer of context.consumers) {
                        const consumed = await consumer.handleMessage(message);
                        if (consumed) break;
                    }
                })();

                return true; // Indicates async response
            };

            chrome.runtime.onUserScriptMessage.addListener(this.userScriptMessageListener);
        }
    }

    /**
     * Cleanup listeners when no more sandboxes
     */
    unregisterSandbox(sandboxId: string): void {
        this.sandboxes.delete(sandboxId);

        if (this.sandboxes.size === 0) {
            // Remove iframe listener
            if (this.messageListener) {
                window.removeEventListener('message', this.messageListener);
                this.messageListener = null;
            }

            // Remove user script listener
            if (this.userScriptMessageListener && typeof chrome !== 'undefined' && chrome.runtime?.onUserScriptMessage) {
                chrome.runtime.onUserScriptMessage.removeListener(this.userScriptMessageListener);
                this.userScriptMessageListener = null;
            }
        }
    }
}

// Update singleton name
export const RUNTIME_MESSAGE_ROUTER = new RuntimeMessageRouter();
```

2. **Update response format:**
   - Sandbox responses: `{ type: 'runtime-response', messageId, success, result?, error? }`
   - User script responses: `{ success, result?, error? }` (returned directly)

**Why:** Single router handles all message types. No duplication.

#### 2.2 Update all imports
**Files to update:**
- `/Users/badlogic/workspaces/pi-mono/packages/web-ui/src/components/SandboxedIframe.ts`
- `/Users/badlogic/workspaces/pi-mono/packages/web-ui/src/components/artifacts/HtmlArtifact.ts`
- `/Users/badlogic/workspaces/pi-mono/packages/web-ui/src/index.ts` (if exported)

**Change:**
```typescript
// BEFORE:
import { SANDBOX_MESSAGE_ROUTER } from './sandbox/SandboxMessageRouter.js';

// AFTER:
import { RUNTIME_MESSAGE_ROUTER } from './sandbox/RuntimeMessageRouter.js';
```

### Phase 3: Refactor Runtime Providers

#### 3.1 Refactor ConsoleRuntimeProvider
**File:** `/Users/badlogic/workspaces/pi-mono/packages/web-ui/src/components/sandbox/ConsoleRuntimeProvider.ts`

**Remove:**
- `complete()` function (line 96)
- Timeout logic (lines 122-129)
- `lastError` tracking (line 52) - move to wrapper if needed

**Keep:**
- Console method overrides (`log`, `error`, `warn`, `info`)
- Error event listeners (`error`, `unhandledrejection`)

**Update to use sendRuntimeMessage:**

```typescript
getRuntime(): (sandboxId: string) => void {
    return (sandboxId: string) => {
        const originalConsole = {
            log: console.log,
            error: console.error,
            warn: console.warn,
            info: console.info,
        };

        ['log', 'error', 'warn', 'info'].forEach((method) => {
            (console as any)[method] = (...args: any[]) => {
                const text = args
                    .map((arg) => {
                        try {
                            return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
                        } catch {
                            return String(arg);
                        }
                    })
                    .join(' ');

                // Send to extension if available (online mode)
                if ((window as any).sendRuntimeMessage) {
                    (window as any).sendRuntimeMessage({
                        type: 'console',
                        method,
                        text,
                    }).catch(() => {
                        // Ignore errors in fire-and-forget console messages
                    });
                }

                // Always log locally too
                (originalConsole as any)[method].apply(console, args);
            };
        });

        // Error listeners
        window.addEventListener('error', (e) => {
            const text =
                (e.error?.stack || e.message || String(e)) + ' at line ' + (e.lineno || '?') + ':' + (e.colno || '?');

            if ((window as any).sendRuntimeMessage) {
                (window as any).sendRuntimeMessage({
                    type: 'console',
                    method: 'error',
                    text,
                }).catch(() => {});
            }
        });

        window.addEventListener('unhandledrejection', (e) => {
            const text = 'Unhandled promise rejection: ' + (e.reason?.message || e.reason || 'Unknown error');

            if ((window as any).sendRuntimeMessage) {
                (window as any).sendRuntimeMessage({
                    type: 'console',
                    method: 'error',
                    text,
                }).catch(() => {});
            }
        });
    };
}
```

**Why:** Console is now fire-and-forget messaging, works online and offline, no lifecycle concerns.

#### 3.2 Refactor ArtifactsRuntimeProvider
**File:** `/Users/badlogic/workspaces/pi-mono/packages/web-ui/src/components/sandbox/ArtifactsRuntimeProvider.ts`

**Add getData() for offline support:**

```typescript
getData(): Record<string, any> {
    // Inject artifact snapshot for offline mode
    const snapshot: Record<string, string> = {};
    const artifacts = this.getArtifactsFn();
    artifacts.forEach((artifact, filename) => {
        snapshot[filename] = artifact.content;
    });
    return { artifacts: snapshot };
}
```

**Update getRuntime() to use sendRuntimeMessage with offline fallback:**

```typescript
getRuntime(): (sandboxId: string) => void {
    return (sandboxId: string) => {
        (window as any).hasArtifact = async (filename: string): Promise<boolean> => {
            // Online: ask extension
            if ((window as any).sendRuntimeMessage) {
                const response = await (window as any).sendRuntimeMessage({
                    type: 'artifact-operation',
                    action: 'has',
                    filename,
                });
                if (response.error) throw new Error(response.error);
                return response.result;
            }
            // Offline: check snapshot
            else {
                return !!(window as any).artifacts?.[filename];
            }
        };

        (window as any).getArtifact = async (filename: string): Promise<any> => {
            // Online: ask extension
            if ((window as any).sendRuntimeMessage) {
                const response = await (window as any).sendRuntimeMessage({
                    type: 'artifact-operation',
                    action: 'get',
                    filename,
                });
                if (response.error) throw new Error(response.error);

                // Auto-parse .json files
                if (filename.endsWith('.json')) {
                    try {
                        return JSON.parse(response.result);
                    } catch (e) {
                        throw new Error(`Failed to parse JSON from ${filename}: ${e}`);
                    }
                }
                return response.result;
            }
            // Offline: read snapshot
            else {
                if (!(window as any).artifacts?.[filename]) {
                    throw new Error(`Artifact not found (offline mode): ${filename}`);
                }
                const content = (window as any).artifacts[filename];

                // Auto-parse .json files
                if (filename.endsWith('.json')) {
                    try {
                        return JSON.parse(content);
                    } catch (e) {
                        throw new Error(`Failed to parse JSON from ${filename}: ${e}`);
                    }
                }
                return content;
            }
        };

        (window as any).createArtifact = async (filename: string, content: any, mimeType?: string): Promise<void> => {
            if (!(window as any).sendRuntimeMessage) {
                throw new Error('Cannot create artifacts in offline mode (read-only)');
            }

            let finalContent = content;
            // Auto-stringify .json files
            if (filename.endsWith('.json') && typeof content !== 'string') {
                finalContent = JSON.stringify(content, null, 2);
            } else if (typeof content !== 'string') {
                finalContent = JSON.stringify(content, null, 2);
            }

            const response = await (window as any).sendRuntimeMessage({
                type: 'artifact-operation',
                action: 'create',
                filename,
                content: finalContent,
                mimeType,
            });
            if (response.error) throw new Error(response.error);
        };

        (window as any).updateArtifact = async (filename: string, content: any, mimeType?: string): Promise<void> => {
            if (!(window as any).sendRuntimeMessage) {
                throw new Error('Cannot update artifacts in offline mode (read-only)');
            }

            let finalContent = content;
            // Auto-stringify .json files
            if (filename.endsWith('.json') && typeof content !== 'string') {
                finalContent = JSON.stringify(content, null, 2);
            } else if (typeof content !== 'string') {
                finalContent = JSON.stringify(content, null, 2);
            }

            const response = await (window as any).sendRuntimeMessage({
                type: 'artifact-operation',
                action: 'update',
                filename,
                content: finalContent,
                mimeType,
            });
            if (response.error) throw new Error(response.error);
        };

        (window as any).deleteArtifact = async (filename: string): Promise<void> => {
            if (!(window as any).sendRuntimeMessage) {
                throw new Error('Cannot delete artifacts in offline mode (read-only)');
            }

            const response = await (window as any).sendRuntimeMessage({
                type: 'artifact-operation',
                action: 'delete',
                filename,
            });
            if (response.error) throw new Error(response.error);
        };
    };
}
```

**Update handleMessage() response format:**

```typescript
async handleMessage(message: any, respond: (response: any) => void): Promise<boolean> {
    if (message.type !== 'artifact-operation') {
        return false;
    }

    const { action, filename, content, mimeType } = message;

    try {
        switch (action) {
            case 'has': {
                const artifacts = this.getArtifactsFn();
                const exists = artifacts.has(filename);
                respond({ success: true, result: exists });
                break;
            }

            case 'get': {
                const artifacts = this.getArtifactsFn();
                const artifact = artifacts.get(filename);
                if (!artifact) {
                    respond({ success: false, error: `Artifact not found: ${filename}` });
                } else {
                    respond({ success: true, result: artifact.content });
                }
                break;
            }

            case 'create': {
                try {
                    await this.createArtifactFn(filename, content, filename);
                    this.appendMessageFn?.({
                        role: 'artifact',
                        action: 'create',
                        filename,
                        content,
                        title: filename,
                        timestamp: new Date().toISOString(),
                    });
                    respond({ success: true });
                } catch (err: any) {
                    respond({ success: false, error: err.message });
                }
                break;
            }

            case 'update': {
                try {
                    await this.updateArtifactFn(filename, content, filename);
                    this.appendMessageFn?.({
                        role: 'artifact',
                        action: 'update',
                        filename,
                        content,
                        timestamp: new Date().toISOString(),
                    });
                    respond({ success: true });
                } catch (err: any) {
                    respond({ success: false, error: err.message });
                }
                break;
            }

            case 'delete': {
                try {
                    await this.deleteArtifactFn(filename);
                    this.appendMessageFn?.({
                        role: 'artifact',
                        action: 'delete',
                        filename,
                        timestamp: new Date().toISOString(),
                    });
                    respond({ success: true });
                } catch (err: any) {
                    respond({ success: false, error: err.message });
                }
                break;
            }

            default:
                respond({ success: false, error: `Unknown artifact action: ${action}` });
        }

        return true;
    } catch (error: any) {
        respond({ success: false, error: error.message });
        return true;
    }
}
```

**Why:** Works online and offline. Consistent API. No postMessage dependency.

#### 3.3 Refactor AttachmentsRuntimeProvider
**File:** `/Users/badlogic/workspaces/pi-mono/packages/web-ui/src/components/sandbox/AttachmentsRuntimeProvider.ts`

**Keep getData() (already correct):**
```typescript
getData(): Record<string, any> {
    const attachmentsData = this.attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        size: a.size,
        content: a.content,
        extractedText: a.extractedText,
    }));

    return { attachments: attachmentsData };
}
```

**Simplify getRuntime() - just read from injected data:**
```typescript
getRuntime(): (sandboxId: string) => void {
    return (sandboxId: string) => {
        // These functions read directly from window.attachments
        // Works both online AND offline (no messaging needed!)

        (window as any).listAttachments = () =>
            ((window as any).attachments || []).map((a: any) => ({
                id: a.id,
                fileName: a.fileName,
                mimeType: a.mimeType,
                size: a.size,
            }));

        (window as any).readTextAttachment = (attachmentId: string) => {
            const a = ((window as any).attachments || []).find((x: any) => x.id === attachmentId);
            if (!a) throw new Error('Attachment not found: ' + attachmentId);
            if (a.extractedText) return a.extractedText;
            try {
                return atob(a.content);
            } catch {
                throw new Error('Failed to decode text content for: ' + attachmentId);
            }
        };

        (window as any).readBinaryAttachment = (attachmentId: string) => {
            const a = ((window as any).attachments || []).find((x: any) => x.id === attachmentId);
            if (!a) throw new Error('Attachment not found: ' + attachmentId);
            const bin = atob(a.content);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return bytes;
        };
    };
}
```

**Remove returnDownloadableFile** (moved to FileDownloadRuntimeProvider)

**Remove handleMessage()** (no longer needed - data is read-only)

**Why:** Attachments are read-only snapshot data. No messaging needed. Works everywhere.

#### 3.4 Create FileDownloadRuntimeProvider
**File:** `/Users/badlogic/workspaces/pi-mono/packages/web-ui/src/components/sandbox/FileDownloadRuntimeProvider.ts` (NEW)

```typescript
import type { SandboxRuntimeProvider } from './SandboxRuntimeProvider.js';

/**
 * File Download Runtime Provider
 *
 * Provides returnDownloadableFile() for creating user downloads.
 * Files returned this way are NOT accessible to the LLM later (one-time download).
 */
export class FileDownloadRuntimeProvider implements SandboxRuntimeProvider {
    getData(): Record<string, any> {
        // No data needed
        return {};
    }

    getRuntime(): (sandboxId: string) => void {
        return (sandboxId: string) => {
            (window as any).returnDownloadableFile = async (fileName: string, content: any, mimeType?: string) => {
                let finalContent: any, finalMimeType: string;

                if (content instanceof Blob) {
                    const arrayBuffer = await content.arrayBuffer();
                    finalContent = new Uint8Array(arrayBuffer);
                    finalMimeType = mimeType || content.type || 'application/octet-stream';
                    if (!mimeType && !content.type) {
                        throw new Error(
                            'returnDownloadableFile: MIME type is required for Blob content. Please provide a mimeType parameter (e.g., "image/png").',
                        );
                    }
                } else if (content instanceof Uint8Array) {
                    finalContent = content;
                    if (!mimeType) {
                        throw new Error(
                            'returnDownloadableFile: MIME type is required for Uint8Array content. Please provide a mimeType parameter (e.g., "image/png").',
                        );
                    }
                    finalMimeType = mimeType;
                } else if (typeof content === 'string') {
                    finalContent = content;
                    finalMimeType = mimeType || 'text/plain';
                } else {
                    finalContent = JSON.stringify(content, null, 2);
                    finalMimeType = mimeType || 'application/json';
                }

                // Send to extension if available
                if ((window as any).sendRuntimeMessage) {
                    const response = await (window as any).sendRuntimeMessage({
                        type: 'file-returned',
                        fileName,
                        content: finalContent,
                        mimeType: finalMimeType,
                    });
                    if (response.error) throw new Error(response.error);
                } else {
                    // Offline mode: trigger browser download directly
                    const blob = new Blob(
                        [finalContent instanceof Uint8Array ? finalContent : finalContent],
                        { type: finalMimeType }
                    );
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = fileName;
                    a.click();
                    URL.revokeObjectURL(url);
                }
            };
        };
    }

    async handleMessage(message: any, respond: (response: any) => void): Promise<boolean> {
        if (message.type !== 'file-returned') {
            return false;
        }

        // Extension context handles creating the actual download
        // This is handled by tool renderers (browser-javascript, javascript-repl)
        // Just acknowledge receipt
        respond({ success: true });
        return true;
    }

    getDescription(): string {
        return `returnDownloadableFile(filename, content, mimeType?) - Create downloadable file for user (one-time download, not accessible later)`;
    }
}
```

**Why:** Clean separation. File downloads are distinct from reading attachments.

### Phase 4: Update SandboxedIframe

#### 4.1 Inject RuntimeMessageBridge
**File:** `/Users/badlogic/workspaces/pi-mono/packages/web-ui/src/components/SandboxedIframe.ts`

**Import RuntimeMessageBridge:**
```typescript
import { RuntimeMessageBridge } from './sandbox/RuntimeMessageBridge.js';
import { RUNTIME_MESSAGE_ROUTER } from './sandbox/RuntimeMessageRouter.js';
```

**Update getRuntimeScript() to inject bridge:**
```typescript
private getRuntimeScript(sandboxId: string, providers: SandboxRuntimeProvider[] = []): string {
    // Collect all data from providers
    const allData: Record<string, any> = {};
    for (const provider of providers) {
        Object.assign(allData, provider.getData());
    }

    // Generate bridge code
    const bridgeCode = RuntimeMessageBridge.generateBridgeCode({
        context: 'sandbox-iframe',
        sandboxId,
    });

    // Collect all runtime functions - pass sandboxId as string literal
    const runtimeFunctions: string[] = [];
    for (const provider of providers) {
        runtimeFunctions.push(`(${provider.getRuntime().toString()})(${JSON.stringify(sandboxId)});`);
    }

    // Build script
    const dataInjection = Object.entries(allData)
        .map(([key, value]) => `window.${key} = ${JSON.stringify(value)};`)
        .join('\n');

    return `<script>
window.sandboxId = ${JSON.stringify(sandboxId)};
${dataInjection}
${bridgeCode}
${runtimeFunctions.join('\n')}
</script>`;
}
```

**Update router calls:**
```typescript
// Change SANDBOX_MESSAGE_ROUTER → RUNTIME_MESSAGE_ROUTER throughout file
```

**Why:** Bridge provides unified messaging. Providers now work identically everywhere.

### Phase 5: Update browser-javascript.ts

#### 5.1 Inject Bridge and Reuse Providers
**File:** `/Users/badlogic/workspaces/sitegeist/src/tools/browser-javascript.ts`

**Import providers:**
```typescript
import { RuntimeMessageBridge } from '@mariozechner/pi-web-ui/components/sandbox/RuntimeMessageBridge.js';
import { RUNTIME_MESSAGE_ROUTER } from '@mariozechner/pi-web-ui/components/sandbox/RuntimeMessageRouter.js';
import { ConsoleRuntimeProvider } from '@mariozechner/pi-web-ui/components/sandbox/ConsoleRuntimeProvider.js';
import { ArtifactsRuntimeProvider } from '@mariozechner/pi-web-ui/components/sandbox/ArtifactsRuntimeProvider.js';
import { AttachmentsRuntimeProvider } from '@mariozechner/pi-web-ui/components/sandbox/AttachmentsRuntimeProvider.js';
import { FileDownloadRuntimeProvider } from '@mariozechner/pi-web-ui/components/sandbox/FileDownloadRuntimeProvider.js';
import type { SandboxRuntimeProvider } from '@mariozechner/pi-web-ui/components/sandbox/SandboxRuntimeProvider.js';
```

**Update buildWrapperCode():**
```typescript
function buildWrapperCode(
    userCode: string,
    skillLibrary: string,
    enableSafeguards: boolean,
    sandboxId: string,
    providers: SandboxRuntimeProvider[],
): string {
    let code = `(${wrapperFunction.toString()})`;

    // Inject safeguards if enabled
    if (enableSafeguards) {
        const safeguardsBody = securitySafeguards
            .toString()
            .replace(/^function securitySafeguards\(\) \{/, '')
            .replace(/\}$/, '');
        code = code.replace(
            /async function wrapperFunction\(\) \{/,
            `async function wrapperFunction() {\n${safeguardsBody}`,
        );
    }

    // Inject skill library
    if (skillLibrary) {
        code = code.replace(
            /async function wrapperFunction\(\) \{/,
            `async function wrapperFunction() {\n${skillLibrary}`,
        );
    }

    // Inject provider data
    const allData: Record<string, any> = {};
    for (const provider of providers) {
        Object.assign(allData, provider.getData());
    }
    const dataInjection = Object.entries(allData)
        .map(([key, value]) => `window.${key} = ${JSON.stringify(value)};`)
        .join('\n');

    if (dataInjection) {
        code = code.replace(
            /async function wrapperFunction\(\) \{/,
            `async function wrapperFunction() {\n${dataInjection}`,
        );
    }

    // Inject runtime bridge
    const bridgeCode = RuntimeMessageBridge.generateBridgeCode({
        context: 'user-script',
        sandboxId,
    });

    code = code.replace(
        /async function wrapperFunction\(\) \{/,
        `async function wrapperFunction() {\n${bridgeCode}`,
    );

    // Inject provider runtimes
    const runtimeFunctions: string[] = [];
    for (const provider of providers) {
        runtimeFunctions.push(`(${provider.getRuntime().toString()})(${JSON.stringify(sandboxId)});`);
    }

    if (runtimeFunctions.length > 0) {
        code = code.replace(
            /async function wrapperFunction\(\) \{/,
            `async function wrapperFunction() {\n${runtimeFunctions.join('\n')}`,
        );
    }

    // Replace USER_CODE_PLACEHOLDER
    code = code.replace(/USER_CODE_PLACEHOLDER/, `async () => { ${userCode} }`);

    return `${code}()`;
}
```

**Simplify wrapperFunction() - remove duplicate code:**
```typescript
async function wrapperFunction() {
    // Capture console output
    const consoleOutput: Array<{ type: string; args: unknown[] }> = [];
    const files: Array<{
        fileName: string;
        content: string | Uint8Array;
        mimeType: string;
    }> = [];
    let timeoutId: number;

    // Store original console (will be overridden by ConsoleRuntimeProvider)
    const originalConsole = {
        log: console.log,
        warn: console.warn,
        error: console.error,
    };

    // Files are collected via FileDownloadRuntimeProvider's message handler
    // Store them in wrapper so we can return them
    const originalSendRuntimeMessage = (window as any).sendRuntimeMessage;
    (window as any).sendRuntimeMessage = async (message: any) => {
        // Intercept file-returned messages
        if (message.type === 'file-returned') {
            files.push({
                fileName: message.fileName,
                content: message.content,
                mimeType: message.mimeType,
            });
            return { success: true };
        }
        // Forward other messages
        return await originalSendRuntimeMessage(message);
    };

    const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        // Providers will be cleaned up automatically
        // Just restore original console
        console.log = originalConsole.log;
        console.warn = originalConsole.warn;
        console.error = originalConsole.error;
    };

    try {
        // Set timeout
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error('Execution timeout: Code did not complete within 30 seconds'));
            }, 30000) as unknown as number;
        });

        // Execute user code
        // @ts-expect-error
        const userCodeFunc = USER_CODE_PLACEHOLDER;
        const codePromise = userCodeFunc();

        const lastValue = await Promise.race([codePromise, timeoutPromise]);

        cleanup();
        return {
            success: true,
            console: consoleOutput,
            files: files,
            lastValue: lastValue,
        };
    } catch (error: any) {
        cleanup();
        return {
            success: false,
            error: error.message,
            stack: error.stack,
            console: consoleOutput,
        };
    }
}
```

**Update execute() method:**
```typescript
execute = async (
    _toolCallId: string,
    args: Static<typeof browserJavaScriptSchema>,
    signal?: AbortSignal,
) => {
    try {
        // ... navigation checks ...

        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
            return { output: 'Error: No active tab found', isError: true, details: { files: [] } };
        }

        // ... permission checks ...

        // Load skills
        const skillsRepo = getSitegeistStorage().skills;
        let skillLibrary = '';
        if (tab.url) {
            const matchingSkills = await skillsRepo.getSkillsForUrl(tab.url);
            if (matchingSkills.length > 0) {
                skillLibrary = `${matchingSkills.map((s) => s.library).join('\n\n')}\n\n`;
            }
        }

        // Create runtime providers
        const sandboxId = `browser-js-${Date.now()}-${Math.random().toString(36).substring(7)}`;

        // Get attachments from most recent user message
        const userMessages = this.agent.state.messages.filter(
            (m): m is UserMessageWithAttachments => m.role === 'user'
        );
        const attachments = userMessages[userMessages.length - 1]?.attachments || [];

        const providers: SandboxRuntimeProvider[] = [
            new ConsoleRuntimeProvider(),
            new AttachmentsRuntimeProvider(attachments),
            new ArtifactsRuntimeProvider(
                () => this.artifactsPanel.artifacts,
                (filename, content, title) => this.artifactsPanel.tool.execute('', { command: 'create', filename, content, title }),
                (filename, content, title) => this.artifactsPanel.tool.execute('', { command: 'rewrite', filename, content, title }),
                (filename) => this.artifactsPanel.tool.execute('', { command: 'delete', filename }),
                (message) => this.agent.appendMessage(message),
            ),
            new FileDownloadRuntimeProvider(),
        ];

        // Register with router
        RUNTIME_MESSAGE_ROUTER.registerSandbox(sandboxId, providers, []);

        // Build wrapper code with providers
        const wrapperCode = buildWrapperCode(args.code, skillLibrary, false, sandboxId, providers);

        let results: any[];

        try {
            // Execute via userScripts API
            if (browser.userScripts && typeof browser.userScripts.execute === 'function') {
                const worldId = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

                try {
                    await browser.userScripts.configureWorld({
                        worldId: worldId,
                        messaging: true,
                        csp: "script-src 'unsafe-eval'; connect-src 'none'; default-src 'none';",
                    });
                } catch (e) {
                    console.warn('Failed to configure userScripts world:', e);
                }

                results = await browser.userScripts.execute({
                    js: [{ code: wrapperCode }],
                    target: { tabId: tab.id },
                    world: 'USER_SCRIPT',
                    worldId: worldId,
                    injectImmediately: true,
                });
            } else {
                return {
                    output: 'Error: Firefox not supported...',
                    isError: true,
                    details: { files: [] },
                };
            }

            // Process results...
            const result = results[0]?.result as any;

            // ... existing result processing logic ...

            return {
                output: output.trim() || 'Code executed successfully (no output)',
                isError: false,
                details: { files },
            };
        } catch (error: unknown) {
            // ... error handling ...
        } finally {
            // Unregister from router
            RUNTIME_MESSAGE_ROUTER.unregisterSandbox(sandboxId);
        }
    } catch (error: unknown) {
        // ... outer error handling ...
    }
};
```

**Remove all duplicate implementations:**
- Remove inline artifact functions (lines 337-421)
- Remove inline returnDownloadableFile (lines 300-335)
- Remove artifact message listener (lines 721-814)
- Keep only console.log capture in wrapperFunction for collecting output

**Why:** Zero duplication. Providers handle everything. Clean and maintainable.

### Phase 6: Update Exports

#### 6.1 Export new providers from web-ui
**File:** `/Users/badlogic/workspaces/pi-mono/packages/web-ui/src/index.ts`

Add exports:
```typescript
// Runtime bridge and router
export { RuntimeMessageBridge } from './components/sandbox/RuntimeMessageBridge.js';
export { RUNTIME_MESSAGE_ROUTER } from './components/sandbox/RuntimeMessageRouter.js';

// Runtime providers
export { ConsoleRuntimeProvider } from './components/sandbox/ConsoleRuntimeProvider.js';
export { ArtifactsRuntimeProvider } from './components/sandbox/ArtifactsRuntimeProvider.js';
export { AttachmentsRuntimeProvider } from './components/sandbox/AttachmentsRuntimeProvider.js';
export { FileDownloadRuntimeProvider } from './components/sandbox/FileDownloadRuntimeProvider.js';
export type { SandboxRuntimeProvider } from './components/sandbox/SandboxRuntimeProvider.js';
```

### Phase 7: Update Prompts (if needed)

#### 7.1 Verify prompt consistency
**Files to check:**
- `/Users/badlogic/workspaces/pi-mono/packages/web-ui/src/prompts/tool-prompts.ts`
- `/Users/badlogic/workspaces/sitegeist/src/prompts/tool-prompts.ts`

Ensure:
- `ARTIFACTS_RUNTIME_PROVIDER_DESCRIPTION` accurately describes online/offline behavior
- `ATTACHMENTS_RUNTIME_DESCRIPTION` is separate from file download description
- File download description is in its own constant (or part of repl/browser-javascript base description)

## Testing Plan

### Test 1: Sandbox iframe (online)
**Location:** `/Users/badlogic/workspaces/pi-mono/packages/web-ui/example/`

1. Create HTML artifact with:
   ```javascript
   console.log(await getArtifact('data.json'));
   console.log(listAttachments());
   await returnDownloadableFile('test.txt', 'hello', 'text/plain');
   ```
2. Verify:
   - ✅ Console logs appear in artifact UI
   - ✅ Artifacts can be read/created/updated
   - ✅ Attachments can be listed/read
   - ✅ File downloads work

### Test 2: User script (extension online)
**Location:** `/Users/badlogic/workspaces/sitegeist/`

1. In browser extension sidepanel, execute browser_javascript:
   ```javascript
   console.log(await getArtifact('notes.md'));
   console.log(listAttachments());
   await createArtifact('page-data.json', {url: location.href});
   await returnDownloadableFile('export.csv', csvData, 'text/csv');
   ```
2. Verify:
   - ✅ Console logs appear in sidepanel
   - ✅ Artifacts can be read/created/updated
   - ✅ Attachments can be listed/read
   - ✅ File downloads work

### Test 3: Downloaded artifact (offline)
**Location:** Any browser

1. Save HTML artifact from extension
2. Open in browser (no extension context)
3. Verify:
   - ✅ Console logs work (browser console only)
   - ✅ Artifacts can be read from snapshot
   - ✅ Attachments can be read from snapshot
   - ✅ File downloads work (direct browser download)
   - ✅ Write operations throw clear errors

### Test 4: Cross-provider compatibility

1. Use all 4 providers together in both contexts
2. Verify no conflicts or interference
3. Verify proper cleanup (no memory leaks)

## Migration Checklist

- [ ] Phase 1: Create RuntimeMessageBridge
- [ ] Phase 2.1: Extend SandboxMessageRouter → RuntimeMessageRouter
- [ ] Phase 2.2: Update all imports
- [ ] Phase 3.1: Refactor ConsoleRuntimeProvider
- [ ] Phase 3.2: Refactor ArtifactsRuntimeProvider
- [ ] Phase 3.3: Refactor AttachmentsRuntimeProvider
- [ ] Phase 3.4: Create FileDownloadRuntimeProvider
- [ ] Phase 4: Update SandboxedIframe
- [ ] Phase 5: Update browser-javascript.ts
- [ ] Phase 6: Update exports
- [ ] Phase 7: Verify prompts
- [ ] Test 1: Sandbox iframe
- [ ] Test 2: User script
- [ ] Test 3: Offline artifact
- [ ] Test 4: Cross-provider compatibility

## Benefits Summary

### Before
- 4 providers × 2 contexts = 8 implementations
- Tight coupling to messaging APIs
- No offline support
- Lifecycle logic in wrong places
- Hard to maintain and extend

### After
- 4 providers × 1 implementation = 4 implementations (50% reduction)
- Abstracted messaging via `sendRuntimeMessage()`
- Full offline support for downloaded artifacts
- Clean separation of concerns
- Easy to add new providers
- Works in sandbox iframe, user script, and offline contexts

### Code Reduction
- **browser-javascript.ts**: ~350 lines removed (artifact/attachment/console duplication)
- **ConsoleRuntimeProvider**: ~30 lines removed (lifecycle junk)
- **Total**: ~400 lines of duplicate code eliminated
- **New code**: ~200 lines (bridge + file download provider)
- **Net reduction**: ~200 lines + massive maintainability improvement
