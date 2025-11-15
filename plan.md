# Providers & Models System

## Overview

Refactor the API Keys tab into a "Providers & Models" system with two provider types:
1. **Known Providers** - Cloud providers (OpenAI, Anthropic, Google, etc.) with predefined models
2. **Custom Providers** - User-configured servers with either auto-discovered or manually-defined models

## Current State

**Files:**
- `pi-mono/packages/web-ui/src/dialogs/SettingsDialog.ts` - Contains `ApiKeysTab`
- `pi-mono/packages/web-ui/src/dialogs/ModelSelector.ts` - Hard-coded Ollama discovery (lines 94-156)
- `pi-mono/packages/web-ui/src/components/ProviderKeyInput.ts` - API key input component
- `pi-mono/packages/ai/src/types.ts` - `Model<TApi>` interface (lines 154-170)
- `pi-mono/packages/ai/src/models.ts` - Model registry (currently read-only)
- `pi-mono/packages/ai/src/models.generated.ts` - Generated known provider models

**Problems:**
1. Only supports cloud providers with API keys
2. Ollama is hard-coded in ModelSelector with no UI configuration
3. No support for other local servers (llama.cpp, LM Studio, vLLM)
4. No way to add custom models or providers

## UX Design

### Tab: "Providers & Models"

```
┌─ Known Providers ──────────────────────────────────────────┐
│ Cloud LLM providers with predefined models.                │
│ API keys are stored locally in your browser.               │
│                                                             │
│ Anthropic                                                   │
│   API Key: [••••••••••••••••••••] [Save]                   │
│   Models: 12 available                                     │
│                                                             │
│ OpenAI                                                      │
│   API Key: [......................] [Save]                 │
│   Models: 8 available                                      │
│                                                             │
│ Google                                                      │
│   API Key: [......................] [Save]                 │
│   Models: 5 available                                      │
│                                                             │
│ (repeat for all known providers)                           │
└─────────────────────────────────────────────────────────────┘

┌─ Custom Providers ─────────────────────── [+ Add Provider] ┐
│ User-configured servers with auto-discovered or manually   │
│ defined models.                                             │
│                                                             │
│ My Ollama Server                                            │
│   • Type: Ollama                                            │
│   • URL: http://localhost:11434                            │
│   • Status: ✓ Connected                                    │
│   • Models: 5 auto-discovered                              │
│   [Edit] [Refresh] [Delete]                                │
│                                                             │
│ Work vLLM Cluster                                           │
│   • Type: vLLM                                              │
│   • URL: https://vllm.company.internal                     │
│   • Status: ✓ Connected                                    │
│   • Models: 12 auto-discovered                             │
│   [Edit] [Refresh] [Delete]                                │
│                                                             │
│ My Custom API                                               │
│   • Type: OpenAI Responses Compatible                      │
│   • URL: https://api.myserver.com                          │
│   • Models: 2 manually defined                             │
│   [Edit] [Delete]                                          │
└─────────────────────────────────────────────────────────────┘
```

### Dialog: "Add/Edit Custom Provider"

**Provider Configuration:**
- **Name**: Display name (e.g., "My Ollama Server")
- **Type**: Dropdown
  - Ollama *(auto-discovers models)*
  - llama.cpp *(auto-discovers models)*
  - vLLM *(auto-discovers models)*
  - OpenAI Completions Compatible *(manual models)*
  - OpenAI Responses Compatible *(manual models)*
  - Anthropic Messages Compatible *(manual models)*
- **Base URL**: Server endpoint
- **API Key**: Optional (applies to all models from this provider)

**For Auto-Discovery Types (Ollama/llama.cpp/vLLM):**
- [Test Connection] button
- Shows discovered models with names and IDs
- User cannot edit model list (auto-managed)

**For Manual Types (OpenAI/Anthropic Compatible):**
- [+ Add Model] button opens model editor
- Shows list of manually-defined models
- Each model fully editable/deletable

### Dialog: "Add/Edit Model"

Only shown for manual provider types. All fields map to `Model<TApi>` interface:

**Basic:**
- **Model ID**: `model.id` (e.g., "my-llama-3.2-ft")
- **Display Name**: `model.name` (e.g., "My Fine-Tuned Llama")
- **API Type**: Dropdown → `model.api`
  - openai-completions
  - openai-responses
  - anthropic-messages
  - google-generative-ai

**Capabilities:**
- **Context Window**: `model.contextWindow` (number)
- **Max Tokens**: `model.maxTokens` (number)
- **Supports Reasoning**: `model.reasoning` (boolean)
- **Input Types**: `model.input` (checkboxes: text, image)

**Costs ($/M tokens):**
- **Input**: `model.cost.input`
- **Output**: `model.cost.output`
- **Cache Read**: `model.cost.cacheRead`
- **Cache Write**: `model.cost.cacheWrite`

**Derived Fields:**
- `model.provider`: Set from parent custom provider name
- `model.baseUrl`: Set from parent custom provider URL

## Data Model

### Storage Schema

**Location:** `pi-mono/packages/web-ui/src/storage/stores/`

```typescript
// File: custom-providers-store.ts
"customProviders" → CustomProvider[]

interface CustomProvider {
  id: string;  // UUID
  name: string;  // Display name, also used as Model.provider
  type: CustomProviderType;
  baseUrl: string;
  apiKey?: string;  // Optional, applies to all models

  // For manual types ONLY - models stored directly on provider
  models?: Model<any>[];
}

type CustomProviderType =
  | "ollama"  // Auto-discovery - models fetched on-demand
  | "llama.cpp"  // Auto-discovery - models fetched on-demand
  | "vllm"  // Auto-discovery - models fetched on-demand
  | "openai-completions"  // Manual models - stored in provider.models
  | "openai-responses"  // Manual models - stored in provider.models
  | "anthropic-messages";  // Manual models - stored in provider.models
```

**Notes:**
- **Single store only** - no separate `customModels` store needed
- `CustomProvider.name` is used as `Model.provider` for all models from that provider
- `CustomProvider.baseUrl` is used as `Model.baseUrl` for all models from that provider
- **Auto-discovery types**: Models are **NOT stored**. Fetched fresh on-demand via discovery functions.
- **Manual types**: Models stored in `provider.models` array directly

### Why Auto-Discovery Models Aren't Stored

**Problem:** User loads/unloads models in Ollama → stale models in our UI

**Solution:** Always fetch fresh when needed:
- **Provider dialog**: "Test Connection" calls discovery function → shows preview
- **Model selector**: On open, calls discovery function for each auto-discovery provider → fresh list
- **No storage**: Only store provider config (name, type, baseUrl, apiKey) - never the models

## Implementation Plan

### 1. Storage Layer (pi-mono/packages/web-ui)

**Create: `src/storage/stores/custom-providers-store.ts`**
- Define `CustomProviderType` type
- Define `CustomProvider` interface
- Implement `CustomProvidersStore` class
- Create `getConfig()` for IndexedDB schema

**Update: `src/storage/app-storage.ts`**
- Add `customProviders: CustomProvidersStore`
- Wire up to IndexedDB
- Increment database version

### 2. Discovery Utilities (pi-mono/packages/web-ui)

**Create: `src/utils/model-discovery.ts`**

```typescript
// Auto-discovery functions - one per provider type
async function discoverOllamaModels(
  baseUrl: string,
  apiKey?: string
): Promise<Model<any>[]>

async function discoverLlamaCppModels(
  baseUrl: string,
  apiKey?: string
): Promise<Model<any>[]>

async function discoverVLLMModels(
  baseUrl: string,
  apiKey?: string
): Promise<Model<any>[]>

// Convenience wrapper
async function discoverModels(
  type: "ollama" | "llama.cpp" | "vllm",
  baseUrl: string,
  apiKey?: string
): Promise<Model<any>[]>
```

**Implementation:**

**`discoverOllamaModels()`:**
- `GET ${baseUrl}/api/tags` → parse model list
- Map to `Model<any>` objects
- Set `api: "openai-completions"` by default
- Special case: if `model.id.includes("gpt-oss")` → `api: "openai-responses"`
- Extract contextWindow/maxTokens if available
- Default costs to 0

**`discoverLlamaCppModels()`:**
- `GET ${baseUrl}/v1/models` → parse OpenAI-compatible response
- Map to `Model<any>` objects
- Set `api: "openai-completions"` for all models (for now)
- Extract contextWindow/maxTokens if available
- Default costs to 0

**`discoverVLLMModels()`:**
- `GET ${baseUrl}/v1/models` → parse OpenAI-compatible response
- Map to `Model<any>` objects
- Set `api: "openai-completions"` for all models (for now)
- Extract contextWindow/maxTokens if available
- Default costs to 0

**Notes:**
- Each function encapsulates provider-specific logic
- `api` field determined per-model based on provider capabilities
- Start simple (default to openai-completions), add special cases as needed
- These functions used by both CustomProviderDialog AND ModelSelector

### 3. Model Registry Updates (pi-mono/packages/ai)

**Update: `src/models.ts`**

Make registry mutable and add:

```typescript
// Register models from a custom provider (auto-discovery or manual)
export function registerProviderModels(
  provider: string,
  models: Model<Api>[]
): void

// Unregister all models from a provider
export function unregisterProvider(provider: string): void

// Clear all custom registrations (for app reset)
export function clearCustomModels(): void
```

**Implementation:**
- Make `modelRegistry` mutable (no longer `as const`)
- `registerProviderModels()` adds/replaces models for a provider
- `unregisterProvider()` removes provider from registry
- `getProviders()` and `getModels()` work transparently with custom models

### 4. UI Components (pi-mono/packages/web-ui)

**Create: `src/components/KnownProvidersList.ts`**
- Loop through known providers from `getProviders()`
- For each provider:
  - Show provider name
  - Show API key input (ProviderKeyInput component)
  - Show model count from `getModels(provider).length`
- Always display all known providers

**Create: `src/components/CustomProvidersList.ts`**
- Load custom providers from storage
- For each provider:
  - Show name, type, URL
  - Show connection status (for auto-discovery types)
  - Show model count
  - Edit/Refresh/Delete buttons
- [+ Add Provider] button opens provider editor

**Create: `src/dialogs/CustomProviderDialog.ts`**
- Form fields: name, type dropdown, baseUrl, apiKey
- For auto-discovery types:
  - [Test Connection] button
  - Shows discovered models
  - Save button stores provider + models
- For manual types:
  - [+ Add Model] button
  - Shows list of models (from customModels store filtered by providerId)
  - Each model has Edit/Delete buttons
- Save/Cancel actions

**Create: `src/dialogs/CustomModelDialog.ts`**
- All fields from `Model<TApi>` interface
- API type dropdown determines available options
- Validation for required fields
- Save creates/updates entry in customModels store
- Cancel discards changes

### 5. Settings Tab Integration (pi-mono/packages/web-ui)

**Update: `src/dialogs/SettingsDialog.ts`**
- Rename `ApiKeysTab` → `ProvidersModelsTab`
- Update `getTabName()` → "Providers & Models"
- Layout:
  1. Section header: "Known Providers"
  2. `KnownProvidersList` component
  3. Section header: "Custom Providers"
  4. `CustomProvidersList` component

**Update: `src/dialogs/ModelSelector.ts`**
- Remove hard-coded Ollama discovery (lines 94-156)
- Remove `ollamaModels`, `ollamaError`, `fetchOllamaModels()`
- Models now come from unified registry (includes custom providers)
- No code changes needed - registry handles everything

### 6. Initialization (pi-mono/packages/web-ui)

**Update: `src/storage/app-storage.ts`**

Add initialization hook:

```typescript
async function initializeModelRegistry() {
  const customProviders = await appStorage.customProviders.getAll();

  // Register manually-defined models from manual provider types
  for (const provider of customProviders) {
    const isManualType = ["openai-completions", "openai-responses", "anthropic-messages"].includes(provider.type);

    if (isManualType && provider.models) {
      registerProviderModels(provider.name, provider.models);
    }

    // Auto-discovery providers: don't register anything at startup
    // Models will be fetched on-demand when ModelSelector opens
  }
}
```

Call on app startup before any model selection happens.

**Model Selector Loading:**
- On open, check for auto-discovery providers
- Call `discoverModels()` for each auto-discovery provider
- Temporarily register discovered models with `registerProviderModels()`
- Display in selector alongside known + manual providers

### 7. Sitegeist Integration

**Update: `sitegeist/src/sidepanel.ts`**
- Import: `import { ProvidersModelsTab } from "@mariozechner/pi-web-ui"`
- Update SettingsDialog to use new tab name

**Update: `sitegeist/src/storage/app-storage.ts`**
- Ensure extended storage includes new custom provider/model stores

### 8. Testing

**Known Providers:**
- [ ] API key save/load for all known providers
- [ ] Model counts display correctly
- [ ] Existing functionality unchanged

**Custom Providers - Auto-Discovery:**
- [ ] Add Ollama server, test connection, save
- [ ] Add llama.cpp server, test connection, save
- [ ] Add vLLM server, test connection, save
- [ ] Refresh button updates model list
- [ ] Connection errors display properly
- [ ] Edit existing server updates models
- [ ] Delete server removes models from registry

**Custom Providers - Manual:**
- [ ] Add OpenAI-compatible provider
- [ ] Add Anthropic-compatible provider
- [ ] Add models with all field combinations
- [ ] Edit model updates registry
- [ ] Delete model removes from registry
- [ ] Provider deletion cascades to models

**Model Selection:**
- [ ] Known provider models appear
- [ ] Custom auto-discovered models appear
- [ ] Custom manual models appear
- [ ] Provider grouping works correctly
- [ ] Model metadata (context, cost, capabilities) correct

**Storage:**
- [ ] Data persists across browser reloads
- [ ] IndexedDB schema migration works
- [ ] No conflicts with existing API keys

## Migration Notes

**No Breaking Changes:**
- Purely additive functionality
- Existing API keys continue to work
- No changes to existing storage schema

**New Dependencies:**
- Ollama client already imported in ModelSelector
- Standard fetch API for other servers

**Storage Migration:**
- New IndexedDB object stores added
- Database version incremented
- No data migration needed

## Open Questions

1. Should auto-discovery types allow manual model editing (override detected values)?
2. Should we validate model IDs for uniqueness across all providers?
3. Should we periodically auto-refresh discovered models in background?
4. Should connection status be shown in ModelSelector or only in settings?
5. Should we allow disabling individual models without deleting them?

## Out of Scope

- Background auto-refresh of server models
- Model performance benchmarking
- Usage statistics per model
- Model tagging/categories
- Import/export configurations
- Shared configurations via URL/JSON
