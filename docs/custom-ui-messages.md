# Custom UI Messages in pi-web-ui

This document explains how to create custom message types with custom UI rendering and LLM transformation in the chat interface.

## Overview

The pi-web-ui framework provides two extension points for custom messages:

1. **UI Rendering**: Custom message renderers for displaying messages in the chat
2. **LLM Transformation**: Message transformers for converting app messages to LLM-compatible format

This enables you to:

- Display custom UI elements (buttons, pills, cards, etc.)
- Trigger actions via DOM events (e.g., `agentInterface.sendMessage()`)
- Pass agent state to custom elements for conditional rendering
- Control how messages are sent to the LLM (transform, filter, or pass through)
- Persist messages in session storage

## Architecture Components

### 1. Message Type System

**`AppMessage`** (`Messages.ts`): Union type of all message types
```typescript
type BaseMessage = AssistantMessage | UserMessage | ToolResultMessage | ArtifactMessage;

export interface CustomMessages {
  // Empty by default - apps extend via declaration merging
}

export type AppMessage = BaseMessage | CustomMessages[keyof CustomMessages];
```

**Extending AppMessage**: Your app adds custom message types via declaration merging
```typescript
// In your app code (e.g., src/messages/WelcomeMessage.ts)
declare module "@mariozechner/pi-web-ui" {
  interface CustomMessages {
    welcome: WelcomeMessage;
    navigation: NavigationMessage;
  }
}
```

### 2. UI Rendering System

**`MessageList`** (`MessageList.ts`): Renders messages in the chat
- Iterates through `agent.state.messages`
- Calls `renderMessage(msg)` for each message
- Falls back to built-in renderers for standard roles
- Passes properties like `tools`, `isStreaming` to built-in renderers

**Message Renderer** (`message-renderer-registry.ts`): Registry for custom renderers
```typescript
export interface MessageRenderer<TMessage extends AppMessage = AppMessage> {
  render(message: TMessage): TemplateResult;
}

// Register a renderer
registerMessageRenderer(role, renderer);

// Lookup and render
renderMessage(message);
```

**Custom Elements**: Lit components that receive message data and agent context
- Can receive agent state via properties passed from renderer
- Use light DOM (`createRenderRoot() { return this; }`) for shared styles
- Dispatch DOM events for actions (bubbling `CustomEvent`)

### 3. Message Transformation System

**`messageTransformer`** (`agent.ts`): Converts `AppMessage[]` to LLM-compatible `Message[]`
- Called before each agent turn (before sending to LLM)
- Filters out UI-only messages (e.g., welcome screens)
- Transforms app-specific messages to standard format
- Can be async (e.g., to load data from storage)

**Default transformer** (`agent.ts`):
```typescript
function defaultMessageTransformer(messages: AppMessage[]): Message[] {
  return messages
    .filter(m => m.role === "user" || m.role === "assistant" || m.role === "toolResult")
    .map(m => {
      const { attachments, ...rest } = m as any;
      return rest as Message;
    });
}
```

**Custom transformer**: Passed to `Agent` constructor
```typescript
const agent = new Agent({
  // ...
  messageTransformer: myCustomTransformer,
});
```

## Implementation Patterns

### Pattern 1: Message That Transforms for LLM (NavigationMessage)

Shows navigation in UI as a clickable pill, sends context to LLM as user message.

#### Step 1: Define Message Type

```typescript
// src/messages/NavigationMessage.ts

export interface NavigationMessage {
  role: "navigation";
  url: string;
  title: string;
  favicon?: string;
  tabIndex?: number;
}

declare module "@mariozechner/pi-web-ui" {
  interface CustomMessages {
    navigation: NavigationMessage;
  }
}
```

#### Step 2: Create Custom Element

```typescript
@customElement("navigation-message")
class NavigationMessageElement extends LitElement {
  @property() url!: string;
  @property() title!: string;
  @property() favicon?: string;
  @state() private skills: Skill[] = [];

  protected createRenderRoot() {
    return this; // light DOM for shared styles
  }

  override async connectedCallback() {
    super.connectedCallback();
    // Can load data from storage
    this.skills = await skillsStore.getSkillsForUrl(this.url);
  }

  override render(): TemplateResult {
    const faviconUrl = this.favicon || getFallbackFavicon(this.url);

    return html`
      <div class="mx-4 my-2">
        <button
          class="inline-flex items-center gap-2 px-3 py-2 text-sm bg-card border rounded-lg"
          @click=${() => chrome.tabs.create({ url: this.url })}
        >
          <img src="${faviconUrl}" class="w-4 h-4" />
          <span>${this.title}</span>
        </button>
        ${this.skills.length > 0
          ? html`<div class="flex gap-2">${this.skills.map(s => renderSkillPill(s))}</div>`
          : ""}
      </div>
    `;
  }
}
```

#### Step 3: Create Renderer

Renderer can access agent state by capturing it in a factory function:

```typescript
// Option A: Simple pass-through (element loads data independently)
const navigationRenderer: MessageRenderer<NavigationMessage> = {
  render: (nav) => html`<navigation-message
    .url=${nav.url}
    .title=${nav.title}
    .favicon=${nav.favicon}>
  </navigation-message>`,
};

// Option B: Factory function with agent access (for conditional rendering)
export function createNavigationRenderer(agent: Agent): MessageRenderer<NavigationMessage> {
  return {
    render: (nav) => {
      // Can access agent.state here for conditional rendering
      const messageCount = agent.state.messages.length;

      return html`<navigation-message
        .url=${nav.url}
        .title=${nav.title}
        .favicon=${nav.favicon}
        .messageCount=${messageCount}>
      </navigation-message>`;
    },
  };
}

// Register
registerMessageRenderer("navigation", createNavigationRenderer(agent));
```

#### Step 4: Register Renderer

```typescript
export function registerNavigationRenderer() {
  registerMessageRenderer("navigation", navigationRenderer);
}

// In app initialization (before messages appear):
registerNavigationRenderer();
```

#### Step 5: Transform for LLM

Custom transformer converts navigation to user message with context:

```typescript
// src/message-transformer.ts

export async function browserMessageTransformer(
  messages: AppMessage[],
): Promise<Message[]> {
  const transformed = [];

  for (const m of messages) {
    // Filter out artifact messages (UI state only)
    if (m.role === "artifact") {
      continue;
    }

    // Transform navigation to user message
    if (m.role === "navigation") {
      const nav = m as NavigationMessage;

      // Load additional context (e.g., skills)
      const skills = await skillsStore.getSkillsForUrl(nav.url);
      const skillsInfo = skills.length > 0
        ? `\n\nSkills available:\n${skills.map(s => s.name).join(", ")}`
        : "";

      transformed.push({
        role: "user",
        content: `<browser-context>Navigated to ${nav.title}: ${nav.url}${skillsInfo}</browser-context>`,
      } as Message);
    }
    // Pass through standard messages
    else if (m.role === "user" || m.role === "assistant" || m.role === "toolResult") {
      // Strip app-specific fields
      const { attachments, ...rest } = m as any;
      transformed.push(rest as Message);
    }
    // Filter out other custom messages
  }

  // Optionally reorder messages (e.g., tool results after tool calls)
  return reorderMessages(transformed);
}

// Pass to agent
const agent = new Agent({
  // ...
  messageTransformer: browserMessageTransformer,
});
```

#### Step 6: Add Messages to Agent

```typescript
// Helper to create message
export function createNavigationMessage(
  url: string,
  title: string,
  favicon?: string,
): NavigationMessage {
  return { role: "navigation", url, title, favicon };
}

// Usage
const navMessage = createNavigationMessage(
  "https://example.com",
  "Example Site",
  "https://example.com/favicon.ico"
);
agent.appendMessage(navMessage);
```

### Pattern 2: UI-Only Message (WelcomeMessage)

Welcome screen that appears in UI but is never sent to LLM.

#### Step 1: Define Message Type

```typescript
// src/messages/WelcomeMessage.ts

export interface TutorialPrompt {
  label: string;
  prompt: string;
}

export interface WelcomeMessage {
  role: "welcome";
  tutorials: TutorialPrompt[];
}

declare module "@mariozechner/pi-web-ui" {
  interface CustomMessages {
    welcome: WelcomeMessage;
  }
}
```

#### Step 2: Create Custom Element with Actions

```typescript
@customElement("welcome-message")
class WelcomeMessageElement extends LitElement {
  @property({ type: Array }) tutorials!: TutorialPrompt[];

  protected createRenderRoot() {
    return this;
  }

  private selectTutorial(prompt: string) {
    // Dispatch bubbling event that parent can listen to
    this.dispatchEvent(
      new CustomEvent("tutorial-selected", {
        detail: { prompt },
        bubbles: true,
        composed: true,
      })
    );
  }

  override render(): TemplateResult {
    return html`
      <div class="mx-4 my-4 p-4 bg-card border border-border rounded-lg">
        <h3 class="text-lg font-semibold mb-2">Welcome to Sitegeist!</h3>
        <p class="text-sm text-muted-foreground mb-3">
          Get started by trying one of these tutorials:
        </p>
        <div class="flex flex-wrap gap-2">
          ${this.tutorials.map(
            (tutorial) => html`
              <button
                class="px-3 py-1.5 text-sm bg-accent hover:bg-accent/80 border rounded-full transition-colors"
                @click=${() => this.selectTutorial(tutorial.prompt)}
              >
                ${tutorial.label}
              </button>
            `
          )}
        </div>
      </div>
    `;
  }
}
```

#### Step 3: Create Conditional Renderer

Renderer with agent access for conditional rendering:

```typescript
export function createWelcomeRenderer(agent: Agent): MessageRenderer<WelcomeMessage> {
  return {
    render: (message) => {
      // Only show if no user/assistant messages exist (excluding this message)
      const hasConversation = agent.state.messages.some(
        m => (m.role === "user" || m.role === "assistant") && m !== message
      );

      if (hasConversation) {
        return html``; // Return empty template to hide
      }

      return html`<welcome-message .tutorials=${message.tutorials}></welcome-message>`;
    },
  };
}

// Register with agent reference
registerMessageRenderer("welcome", createWelcomeRenderer(agent));
```

#### Step 4: Listen for Tutorial Selection

```typescript
// In app initialization (e.g., sidepanel.ts)
document.addEventListener("tutorial-selected", (e: CustomEvent) => {
  const { prompt } = e.detail;

  // Remove welcome message when tutorial is selected
  const messages = agent.state.messages.filter(m => m.role !== "welcome");
  agent.replaceMessages(messages);

  // Send tutorial prompt
  chatPanel.agentInterface?.sendMessage(prompt);
});
```

#### Step 5: Filter from LLM

```typescript
// src/message-transformer.ts

export async function myMessageTransformer(
  messages: AppMessage[],
): Promise<Message[]> {
  const transformed = [];

  for (const m of messages) {
    // Filter out welcome messages - UI only, not for LLM
    if (m.role === "welcome") {
      continue;
    }

    // Filter out artifact messages - session state only
    if (m.role === "artifact") {
      continue;
    }

    // Pass through standard messages
    if (m.role === "user" || m.role === "assistant" || m.role === "toolResult") {
      const { attachments, ...rest } = m as any;
      transformed.push(rest as Message);
    }
  }

  return transformed;
}
```

#### Step 6: Add Welcome Message

```typescript
// In app initialization
const agent = new Agent({ /* ... */ });

// Add welcome message to initial state
const welcomeMessage: WelcomeMessage = {
  role: "welcome",
  tutorials: [
    { label: "Search Google", prompt: "Search Google for 'TypeScript tutorials'" },
    { label: "Analyze Page", prompt: "What's on this page?" },
    { label: "Create Chart", prompt: "Create a bar chart with sample data" },
  ],
};

agent.appendMessage(welcomeMessage);
```

## Message Lifecycle

```
┌─────────────────────┐
│ User Action         │
│ (button click, etc) │
└──────────┬──────────┘
           │
           v
┌─────────────────────┐
│ Create AppMessage   │
│ with custom role    │
└──────────┬──────────┘
           │
           v
┌─────────────────────┐
│ agent.appendMessage │
│ (adds to state)     │
└──────────┬──────────┘
           │
           ├──────────────────────┐
           v                      v
    ┌─────────────┐       ┌──────────────┐
    │ MessageList │       │ Agent.turn() │
    │ (UI render) │       │ (LLM call)   │
    └──────┬──────┘       └──────┬───────┘
           │                     │
           v                     v
    ┌──────────────────┐  ┌──────────────────────┐
    │ renderMessage()  │  │ messageTransformer() │
    │ (custom renderer)│  │ (transform/filter)   │
    └──────┬───────────┘  └──────┬───────────────┘
           │                     │
           v                     v
    ┌──────────────────┐  ┌─────────────────┐
    │ Custom Element   │  │ LLM-compatible  │
    │ (display in UI)  │  │ Message[]       │
    └──────────────────┘  └─────────────────┘
```

## Key Concepts

### Accessing Agent State in Renderers

Renderers receive only the message. To access agent state:

**Factory Pattern** (Recommended):
```typescript
function createRenderer(agent: Agent): MessageRenderer<MyMessage> {
  return {
    render: (msg) => {
      // Closure captures agent reference
      const hasMessages = agent.state.messages.length > 0;
      return html`<my-element .hasMessages=${hasMessages} />`;
    },
  };
}

// Register with agent
registerMessageRenderer("my-role", createRenderer(agent));
```

### Event-Based Actions

Custom elements can't access `agentInterface` directly. Use DOM events:

```typescript
// In custom element
this.dispatchEvent(new CustomEvent("my-action", {
  detail: { data },
  bubbles: true,
  composed: true,
}));

// In app
document.addEventListener("my-action", (e) => {
  chatPanel.agentInterface?.sendMessage(e.detail.data);
});
```

### Message Transformation Strategies

**Filter (UI-only messages)**:
```typescript
if (m.role === "welcome") continue; // Don't send to LLM
```

**Transform (different in LLM)**:
```typescript
if (m.role === "navigation") {
  return { role: "user", content: `Navigated to ${m.url}` };
}
```

**Pass-through (same everywhere)**:
```typescript
const { attachments, ...rest } = m as any;
return rest as Message;
```

### Message Reordering

Transformers can reorder messages before sending to LLM:

```typescript
function reorderMessages(messages: Message[]): Message[] {
  // Ensure tool results immediately follow tool calls
  // See sitegeist/src/message-transformer.ts for full implementation
}
```

## Best Practices

### ✅ DO

- **Store minimal data in messages** - they persist in session storage
- **Use factory pattern** for renderers that need agent state access
- **Use DOM events** for actions that need `agentInterface`
- **Filter UI-only messages** in transformer to avoid confusing LLM
- **Load data in `connectedCallback()`** for async operations in custom elements
- **Make transformer async** if you need to await storage/network calls

### ❌ DON'T

- **Store callbacks in messages** - they won't persist
- **Store large objects in messages** - bloats session storage
- **Send custom roles directly to LLM** - LLM won't understand them
- **Access agent from within custom element** - no injection mechanism
- **Forget to register renderers** before messages appear

## Files Reference

### Core Framework Files

- **Message types**: `pi-mono/packages/web-ui/src/components/Messages.ts`
- **Message list rendering**: `pi-mono/packages/web-ui/src/components/MessageList.ts`
- **Renderer registry**: `pi-mono/packages/web-ui/src/components/message-renderer-registry.ts`
- **Agent and transformer**: `pi-mono/packages/web-ui/src/agent/agent.ts`

### Example Implementation Files

- **Navigation message**: `sitegeist/src/messages/NavigationMessage.ts`
- **Message transformer**: `sitegeist/src/message-transformer.ts`
- **Agent setup**: `sitegeist/src/sidepanel.ts` (lines 122-139, 167-214)
