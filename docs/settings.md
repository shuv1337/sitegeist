# Settings Storage

## Overview

Sitegeist uses a key-value settings store for application configuration like theme, proxy settings, and user preferences. Settings are stored in IndexedDB and accessed through the `SettingsStore` class from `@mariozechner/pi-web-ui`.

## Architecture

### SettingsStore

The `SettingsStore` is a simple key-value store with no schema constraints. It provides basic CRUD operations:

```typescript
class SettingsStore {
  async get<T>(key: string): Promise<T | null>
  async set<T>(key: string, value: T): Promise<void>
  async delete(key: string): Promise<void>
  async list(): Promise<string[]>
  async clear(): Promise<void>
}
```

### Accessing Settings

Settings are accessed through the global `AppStorage` instance:

```typescript
import { getSitegeistStorage } from "./storage/app-storage.js";

const storage = getSitegeistStorage();

// Read a setting
const proxyEnabled = await storage.settings.get<boolean>("proxy.enabled");

// Write a setting
await storage.settings.set("proxy.enabled", true);
```

## Storage Location

Settings are stored in IndexedDB under:
- **Database**: `sitegeist-storage`
- **Store**: `settings`
- **Key Path**: Out-of-line keys (keys stored separately from values)

## Existing Settings

### Proxy Configuration

Used for CORS proxy support when making cross-origin requests:

| Key | Type | Description |
|-----|------|-------------|
| `proxy.enabled` | `boolean` | Whether the CORS proxy is enabled |
| `proxy.url` | `string` | URL of the CORS proxy server |

**Example:**
```typescript
// Check if proxy is enabled
const proxyEnabled = await storage.settings.get<boolean>("proxy.enabled");

// Set proxy configuration
await storage.settings.set("proxy.enabled", true);
await storage.settings.set("proxy.url", "http://localhost:3001");
```

### Last Used Model

Stores the most recently selected model to restore on new sessions:

| Key | Type |
|-----|------|
| `lastUsedModel` | `Model<any>` |

**Example:**
```typescript
// Save last used model
await storage.settings.set("lastUsedModel", model);

// Restore last used model
const model = await storage.settings.get<string>("lastUsedModel");

if (model) {
  ...
}
```

## Adding New Settings

### Step 1: Define Setting Keys

Use dot notation for namespacing related settings:

```typescript
// Good: Namespaced keys
"feature.enabled"
"feature.config"

// Bad: Flat keys
"featureEnabled"
"featureConfig"
```

### Step 2: Define TypeScript Type

Create a type for type-safe access:

```typescript
interface LastUsedModel {
  provider: string;
  modelId: string;
}
```

### Step 3: Read and Write Settings

```typescript
// Write
const model = agent.state.model;
await storage.settings.set("lastUsedModel.provider", model.provider);
await storage.settings.set("lastUsedModel.modelId", model.id);

// Read
const provider = await storage.settings.get<string>("lastUsedModel.provider");
const modelId = await storage.settings.get<string>("lastUsedModel.modelId");

// Use with validation
if (provider && modelId) {
  try {
    const model = getModel(provider as any, modelId);
    // Use model
  } catch (error) {
    // Handle invalid model (provider/model no longer exists)
    console.error("Failed to restore model:", error);
  }
}
```

## Best Practices

### 1. Use Namespaced Keys

Group related settings with dot notation:

```typescript
// ✅ Good
await storage.settings.set("editor.fontSize", 14);
await storage.settings.set("editor.theme", "dark");

// ❌ Bad
await storage.settings.set("editorFontSize", 14);
await storage.settings.set("editorTheme", "dark");
```

### 2. Always Type Your Values

Use TypeScript generics for type safety:

```typescript
// ✅ Good
const enabled = await storage.settings.get<boolean>("feature.enabled");

// ❌ Bad
const enabled = await storage.settings.get("feature.enabled"); // Type: unknown
```

### 3. Handle Missing Values

Settings return `null` if not found. Always handle this case:

```typescript
// ✅ Good
const fontSize = await storage.settings.get<number>("editor.fontSize") ?? 14;

// ✅ Also good
const fontSize = await storage.settings.get<number>("editor.fontSize");
if (fontSize === null) {
  // Use default
}

// ❌ Bad
const fontSize = await storage.settings.get<number>("editor.fontSize");
document.body.style.fontSize = `${fontSize}px`; // Crashes if null
```

### 4. Validate Complex Settings

For settings that depend on external state (like model IDs), validate after reading:

```typescript
const modelId = await storage.settings.get<string>("lastUsedModel.modelId");
if (modelId) {
  try {
    // Validate the model still exists
    const model = getModel(provider as any, modelId);
    agent.setModel(model);
  } catch (error) {
    // Model no longer exists, fall back to default
    console.warn("Saved model not found, using default");
  }
}
```

### 5. Provide Defaults

Always have sensible defaults when settings are missing:

```typescript
const proxyUrl = await storage.settings.get<string>("proxy.url") ?? "http://localhost:3001";
const proxyEnabled = await storage.settings.get<boolean>("proxy.enabled") ?? false;
```

## Settings vs. Session Data

**When to use Settings:**
- User preferences that persist across all sessions
- Application configuration
- Feature flags
- UI preferences (theme, layout, etc.)

**When to use Session Store:**
- Conversation history
- Model state for specific chat
- Session-specific context
- Messages and tool results

**Example:**
```typescript
// ✅ Settings - Applies to all sessions
await storage.settings.set("ui.theme", "dark");

// ✅ Session - Specific to one conversation
await storage.sessions.saveSession(sessionId, {
  model: currentModel,
  messages: chatHistory,
});
```

## Debugging

### List All Settings

```typescript
const keys = await storage.settings.list();
console.log("All settings:", keys);

for (const key of keys) {
  const value = await storage.settings.get(key);
  console.log(`${key}:`, value);
}
```

### Clear All Settings

```typescript
// ⚠️ Warning: This deletes ALL settings
await storage.settings.clear();
```

### Delete Specific Setting

```typescript
await storage.settings.delete("proxy.enabled");
```

## Testing

When testing features that use settings:

```typescript
// Setup
beforeEach(async () => {
  await storage.settings.clear();
  await storage.settings.set("test.value", 123);
});

// Teardown
afterEach(async () => {
  await storage.settings.clear();
});

// Test
test("reads setting", async () => {
  const value = await storage.settings.get<number>("test.value");
  expect(value).toBe(123);
});
```

## Migration

If you need to rename or restructure settings:

```typescript
// Migration function
async function migrateSettings() {
  // Old key
  const oldValue = await storage.settings.get("oldKey");

  if (oldValue !== null) {
    // Write to new key
    await storage.settings.set("new.key", oldValue);

    // Delete old key
    await storage.settings.delete("oldKey");
  }
}

// Run on app startup
await migrateSettings();
```

## Common Patterns

### Feature Flags

```typescript
async function isFeatureEnabled(feature: string): Promise<boolean> {
  return await storage.settings.get<boolean>(`features.${feature}`) ?? false;
}

await storage.settings.set("features.betaMode", true);
if (await isFeatureEnabled("betaMode")) {
  // Enable beta features
}
```

### User Preferences

```typescript
interface UserPreferences {
  theme: "light" | "dark";
  fontSize: number;
  autoSave: boolean;
}

async function getUserPreferences(): Promise<UserPreferences> {
  return {
    theme: await storage.settings.get<"light" | "dark">("user.theme") ?? "dark",
    fontSize: await storage.settings.get<number>("user.fontSize") ?? 14,
    autoSave: await storage.settings.get<boolean>("user.autoSave") ?? true,
  };
}
```

### Configuration Objects

For complex settings, store as a single JSON object:

```typescript
interface ProxyConfig {
  enabled: boolean;
  url: string;
  timeout: number;
}

// Write
const config: ProxyConfig = {
  enabled: true,
  url: "http://localhost:3001",
  timeout: 5000,
};
await storage.settings.set("proxy", config);

// Read
const config = await storage.settings.get<ProxyConfig>("proxy");
if (config) {
  // Use config.enabled, config.url, etc.
}
```

## See Also

- [Storage Architecture](./storage.md) - Overall storage system
- [Session Management](./storage.md#sessions) - Session-specific data
- [Provider Keys](./storage.md#provider-keys) - API key storage
