# Tool Renderer Specification

## Overview

Tool renderers are responsible for displaying tool parameters and results in the chat interface. This document defines the standard approach for creating consistent, accessible, and visually coherent tool renderers.

**Test Page**: [tool-renderers.html](../tool-renderers.html) - Live viewer for testing all renderer states

## Architecture

### Unified Render Method (Current Standard)

Modern tool renderers use a single `render()` method that handles all states:

```typescript
export interface ToolRenderer<TParams = any, TDetails = any> {
  render(
    params: TParams | undefined,
    result: ToolResultMessage<TDetails> | undefined,
    isStreaming?: boolean
  ): TemplateResult;
}
```

**Reference Implementations**:
- [BashRenderer.ts](../../pi-mono/packages/web-ui/src/tools/renderers/BashRenderer.ts)
- [CalculateRenderer.ts](../../pi-mono/packages/web-ui/src/tools/renderers/CalculateRenderer.ts)
- [GetCurrentTimeRenderer.ts](../../pi-mono/packages/web-ui/src/tools/renderers/GetCurrentTimeRenderer.ts)
- [javascript-repl.ts](../../pi-mono/packages/web-ui/src/tools/javascript-repl.ts)
- [skill.ts](../src/tools/skill.ts) - Complex multi-action renderer
- [browser-javascript.ts](../src/tools/browser-javascript.ts)

### Helper: renderHeader()

The `renderHeader()` helper (from [renderer-registry.ts](../../pi-mono/packages/web-ui/src/tools/renderer-registry.ts)) provides consistent header styling with status icons:

```typescript
renderHeader(
  state: "inprogress" | "complete" | "error",
  toolIcon: any,  // Lucide icon
  text: string
): TemplateResult
```

**Behavior**:
- **inprogress**: Icon on left (foreground color), spinner on right
- **complete**: Icon on left (green), no spinner
- **error**: Icon on left (red/destructive), no spinner

**Example**:
```typescript
const state = result ? (result.isError ? "error" : "complete") : "inprogress";
return renderHeader(state, SquareTerminal, i18n("Running command..."));
```

### State Flow Pattern

All renderers follow this pattern:

```typescript
render(params, result, isStreaming): TemplateResult {
  // 1. Determine state
  const state = result
    ? (result.isError ? "error" : "complete")
    : "inprogress";

  // 2. Handle: Full params + Full result
  if (result && params) {
    if (result.isError) {
      // Show error state
    }
    // Show success state
  }

  // 3. Handle: Full params, no result (streaming)
  if (params) {
    // Show in-progress state
  }

  // 4. Handle: No params, no result
  return renderHeader(state, Icon, i18n("Waiting..."));
}
```

## Design Principles

### 1. **Minimal Chrome**

Renderers return **content only**, wrapped in simple spacing containers.

❌ **Bad** (unnecessary borders):
```typescript
return html`
  <div class="rounded-md border border-border bg-card p-3">
    Content here
  </div>
`;
```

✅ **Good** (content with spacing):
```typescript
return html`
  <div class="space-y-3">
    ${renderHeader(state, Icon, i18n("Action"))}
    <code-block .code=${code} language="javascript"></code-block>
  </div>
`;
```

### 2. **Status Indication**

**Always use `renderHeader()` for consistency**:
- Shows appropriate icon color for state
- Handles spinner placement automatically
- Maintains consistent spacing

### 3. **Typography Scale**

- **Headers**: Handled by `renderHeader()` (text-sm text-muted-foreground)
- **Error messages**: `text-sm text-destructive`
- **Secondary text**: `text-sm text-muted-foreground`
- **Labels**: `text-sm font-medium text-muted-foreground`
- **Code/technical**: Handled by `code-block` and `console-block` components

### 4. **Spacing**

- **Vertical rhythm**: `space-y-3` for main sections, `space-y-2` for related items
- **Horizontal spacing**: `gap-2` for inline items, `flex-wrap gap-2` for pill lists
- **No extra padding**: Content goes directly in container

### 5. **Error Handling**

**Subtle, not aggressive**:
- Text color: `text-destructive` (no borders, no backgrounds unless in a pill)
- Error pills: `bg-destructive/10 border border-destructive` (for skill renderer errors)
- Console blocks: `.variant=${"error"}` (uses text-destructive, no border change)

❌ **Bad**:
```typescript
<div class="border-2 border-red-500 bg-red-50 p-4">Error!</div>
```

✅ **Good**:
```typescript
${renderHeader(state, Icon, headerText)}
<div class="text-sm text-destructive">${error}</div>
```

## Pattern Library

### Pattern 1: Simple Command Execution

**Use case**: bash, javascript-repl
**Visual Weight**: Minimal
**Pattern**: Header + Code block + Optional output

**Example** ([BashRenderer.ts](../../pi-mono/packages/web-ui/src/tools/renderers/BashRenderer.ts)):

```typescript
render(params, result): TemplateResult {
  const state = result ? (result.isError ? "error" : "complete") : "inprogress";

  // With result: show command + output in single console block
  if (result && params?.command) {
    const output = result.output || "";
    const combined = output ? `> ${params.command}\n\n${output}` : `> ${params.command}`;
    return html`
      <div class="space-y-3">
        ${renderHeader(state, SquareTerminal, i18n("Running command..."))}
        <console-block
          .content=${combined}
          .variant=${result.isError ? "error" : "default"}>
        </console-block>
      </div>
    `;
  }

  // Just params (streaming)
  if (params?.command) {
    return html`
      <div class="space-y-3">
        ${renderHeader(state, SquareTerminal, i18n("Running command..."))}
        <console-block .content=${`> ${params.command}`}></console-block>
      </div>
    `;
  }

  // No params yet
  return renderHeader(state, SquareTerminal, i18n("Waiting for command..."));
}
```

### Pattern 2: Inline Result in Header

**Use case**: calculate, get_current_time
**Visual Weight**: Minimal (single line when successful)
**Pattern**: Show result directly in header row, error below if needed

**Example** ([CalculateRenderer.ts](../../pi-mono/packages/web-ui/src/tools/renderers/CalculateRenderer.ts)):

```typescript
render(params, result): TemplateResult {
  const state = result ? (result.isError ? "error" : "complete") : "inprogress";

  // Full params + result
  if (result && params?.expression) {
    const output = result.output || "";

    // Error: show expression in header, error below
    if (result.isError) {
      return html`
        <div class="space-y-3">
          ${renderHeader(state, Calculator, params.expression)}
          <div class="text-sm text-destructive">${output}</div>
        </div>
      `;
    }

    // Success: show expression = result in header (single line)
    return renderHeader(state, Calculator, `${params.expression} = ${output}`);
  }

  // Full params, no result
  if (params?.expression) {
    return renderHeader(state, Calculator, `${i18n("Calculating")} ${params.expression}`);
  }

  // No params
  return renderHeader(state, Calculator, i18n("Waiting for expression..."));
}
```

### Pattern 3: Multi-Action Complex Renderer

**Use case**: skill management, API operations
**Visual Weight**: Medium, shows fields as they stream in
**Pattern**: Action-specific rendering with helper functions

**Example** ([skill.ts](../src/tools/skill.ts)):

```typescript
render(params, result): TemplateResult {
  const state = result ? (result.isError ? "error" : "complete") : "inprogress";

  // Helper to render skill fields
  const renderSkillFields = (skill: Partial<Skill>, showLibrary: boolean) => html`
    ${skill.domainPatterns?.length ? renderDomainPills(skill.domainPatterns) : ""}
    ${skill.shortDescription ? html`<div class="text-sm text-muted-foreground">${skill.shortDescription}</div>` : ""}
    ${skill.description ? html`<markdown-block .content=${skill.description}></markdown-block>` : ""}
    ${skill.examples ? html`
      <div class="space-y-2">
        <div class="text-sm font-medium text-muted-foreground">${i18n("Examples")}</div>
        <code-block .code=${skill.examples} language="javascript"></code-block>
      </div>
    ` : ""}
    ${showLibrary && skill.library ? html`
      <div class="space-y-2">
        <div class="text-sm font-medium text-muted-foreground">${i18n("Library")}</div>
        <code-block .code=${skill.library} language="javascript"></code-block>
      </div>
    ` : ""}
  `;

  // Full params + result
  if (result && params) {
    const { action } = params;
    const skill = result.details;

    switch (action) {
      case "create":
      case "update": {
        const skillData = skill || params.data || {};
        const headerText = action === "create"
          ? (state === "complete" ? i18n("Created skill") : i18n("Creating skill"))
          : (state === "complete" ? i18n("Updated skill") : i18n("Updating skill"));

        return html`
          <div class="space-y-3">
            ${renderHeader(state, Sparkles, headerText)}
            ${renderSkillFields(skillData, true)}
          </div>
        `;
      }

      case "list": {
        const skills = skill?.skills || [];
        const domain = skills[0]?.domainPatterns?.[0] || "";
        const statusIcon = html`<span class="inline-block text-green-600 dark:text-green-500">${icon(Sparkles, "sm")}</span>`;

        return html`
          <div class="space-y-3">
            <div class="flex items-center gap-2 text-sm text-muted-foreground">
              ${statusIcon}
              <span>${i18n("Skills for domain")}</span>
              ${domain ? DomainPill(domain) : ""}
            </div>
            <div class="flex flex-wrap gap-2">
              ${skills.map(s => SkillPill(s, true))}
            </div>
          </div>
        `;
      }

      // ... other actions
    }
  }

  // Streaming state (params only)
  if (params) {
    const { action, name, data } = params;
    // ... handle streaming for each action type
  }

  return renderHeader(state, Sparkles, i18n("Processing skill..."));
}
```

### Pattern 4: Code + Output + Attachments

**Use case**: javascript-repl, browser-javascript
**Visual Weight**: Medium to heavy (depends on output)
**Pattern**: Show code, output, and generated files

**Example** ([javascript-repl.ts](../../pi-mono/packages/web-ui/src/tools/javascript-repl.ts)):

```typescript
render(params, result, isStreaming): TemplateResult {
  const state = result ? (result.isError ? "error" : "complete") : "inprogress";

  // Full params + result
  if (result && params) {
    const output = result.output || "";
    const files = result.details?.files || [];

    const attachments: Attachment[] = files.map((f, i) => ({
      id: `repl-${Date.now()}-${i}`,
      type: f.mimeType?.startsWith("image/") ? "image" : "document",
      fileName: f.fileName || `file-${i}`,
      mimeType: f.mimeType || "application/octet-stream",
      size: f.size ?? 0,
      content: f.contentBase64,
      preview: f.mimeType?.startsWith("image/") ? f.contentBase64 : undefined,
      extractedText: /* decode if text-based */,
    }));

    return html`
      <div class="space-y-3">
        ${renderHeader(state, Code, i18n("Executing JavaScript"))}
        <code-block .code=${params.code || ""} language="javascript"></code-block>
        ${output ? html`<console-block .content=${output} .variant=${result.isError ? "error" : "default"}></console-block>` : ""}
        ${attachments.length ? html`
          <div class="flex flex-wrap gap-2">
            ${attachments.map(att => html`<attachment-tile .attachment=${att}></attachment-tile>`)}
          </div>
        ` : ""}
      </div>
    `;
  }

  // Just params (streaming)
  if (params) {
    return html`
      <div class="space-y-3">
        ${renderHeader(state, Code, i18n("Executing JavaScript"))}
        ${params.code ? html`<code-block .code=${params.code} language="javascript"></code-block>` : ""}
      </div>
    `;
  }

  // No params or result yet
  return renderHeader(state, Code, i18n("Preparing JavaScript..."));
}
```

## Component Library

### Mini-Lit Components

From `@mariozechner/mini-lit`:

- **`<code-block>`** ([CodeBlock.ts](../../mini-lit/src/CodeBlock.ts)): Syntax-highlighted code with copy button
  ```typescript
  <code-block .code=${code} language="javascript"></code-block>
  ```

- **`<markdown-block>`** ([MarkdownBlock.ts](../../mini-lit/src/MarkdownBlock.ts)): Rendered markdown
  ```typescript
  <markdown-block .content=${markdown}></markdown-block>
  ```

- **`Button()`** ([Button.ts](../../mini-lit/src/Button.ts)): Styled button helper
  ```typescript
  Button({ variant: "default", onClick: () => {}, children: i18n("Click me") })
  ```

- **`icon()`** ([icons.ts](../../mini-lit/src/icons.ts)): Lucide icon helper
  ```typescript
  icon(Sparkles, "sm")  // small size
  icon(Code, "md")      // medium size
  ```

### Web-UI Components

From `@mariozechner/pi-web-ui`:

- **`<console-block>`** ([ConsoleBlock.ts](../../pi-mono/packages/web-ui/src/components/ConsoleBlock.ts)): Console output with copy button
  ```typescript
  <console-block .content=${output} .variant=${"error" | "default"}></console-block>
  ```

- **`<attachment-tile>`** ([AttachmentTile.ts](../../pi-mono/packages/web-ui/src/components/AttachmentTile.ts)): File attachment display
  ```typescript
  <attachment-tile .attachment=${attachment}></attachment-tile>
  ```

- **`Diff()`** ([Diff.ts](../../mini-lit/src/Diff.ts)): Text diff viewer
  ```typescript
  Diff({ oldText, newText })
  ```

### Custom Functional Components

For reusable UI elements, create functional components (from [mini-lit README](../../mini-lit/README.md)):

```typescript
// DomainPill.ts - Stateless functional component
import { html, type TemplateResult } from "@mariozechner/mini-lit";
import { getFaviconUrl } from "../utils/favicon.js";

export function DomainPill(domain: string): TemplateResult {
  return html`
    <div class="inline-flex items-center gap-2 px-2 py-1 text-xs bg-muted/50 border border-border rounded">
      <img src=${getFaviconUrl(domain, 16)} width="16" height="16" alt="" />
      <code class="text-muted-foreground">${domain}</code>
    </div>
  `;
}
```

**When to use functional components vs custom elements**:
- **Functional components**: Stateless UI (pills, badges, simple displays)
- **Custom elements**: Stateful interactions (dialogs, editors, complex controls)

## Internationalization (i18n)

### Rules

1. **Wrap ALL user-facing text** in `i18n()` function
2. **Don't translate**:
   - Code snippets
   - Technical identifiers (variable names, function names)
   - File names (unless part of UI label)
   - Domain patterns
   - URLs
   - Error messages from external APIs

3. **Consistency**: Use consistent terminology
   - Present continuous for streaming: "Creating skill", "Updating skill"
   - Past tense for complete: "Created skill", "Updated skill"
   - "Getting" → "Got" for retrieval operations
   - No colons after action labels (e.g., "Getting skill youtube-essentials" not "Getting skill: youtube-essentials")

### Adding i18n Strings

For **sitegeist** tools, add strings to [i18n-extension.ts](../src/utils/i18n-extension.ts):

```typescript
declare module "@mariozechner/mini-lit" {
  interface i18nMessages {
    "Creating skill": string;
    "Created skill": string;
    "Execute JavaScript": string;
  }
}

const sitegeistTranslations = {
  en: {
    "Creating skill": "Creating skill",
    "Created skill": "Created skill",
    "Execute JavaScript": "Execute JavaScript",
  },
  de: {
    "Creating skill": "Erstelle Skill",
    "Created skill": "Skill erstellt",
    "Execute JavaScript": "Führe JavaScript aus",
  },
};
```

For **web-ui** tools, add strings to [i18n.ts](../../pi-mono/packages/web-ui/src/utils/i18n.ts).

### Examples

✅ **Good**:
```typescript
return html`
  <div class="space-y-3">
    ${renderHeader(state, Globe, i18n("Execute JavaScript"))}
    <code-block .code=${params.code} language="javascript"></code-block>
  </div>
`;
```

❌ **Bad**:
```typescript
return html`
  <div class="space-y-3">
    ${renderHeader(state, Globe, "Execute JavaScript")}  // Not internationalized!
    <code-block .code=${params.code} language="javascript"></code-block>
  </div>
`;
```

## Testing

### Test Page

Use [tool-renderers.html](../tool-renderers.html) to test all renderer states:

```typescript
// In tool-renderers.ts, add test cases for each action
skill: [
  // CREATE action
  { name: "create-no-params", label: "Create: No params, no result", params: undefined },
  { name: "create-partial-params", label: "Create: Partial params", params: { action: "create" } },
  { name: "create-full-params", label: "Create: Full params, no result", isStreaming: true, params: { /* full data */ } },
  { name: "create-full-result", label: "Create: Full params + result", params: { /* ... */ }, result: { /* ... */ } },
  { name: "create-error", label: "Create: Error", params: { /* ... */ }, result: { isError: true, /* ... */ } },

  // Repeat for UPDATE, GET, LIST, DELETE actions...
]
```

### Required Test Cases

For **each action** in multi-action tools, test:

1. **No params, no result** - Default/waiting state
2. **Partial params (action only), no result** - Action specified but no data
3. **Full params, no result (streaming)** - All data streaming in
4. **Full params + full result** - Completed successfully
5. **Error state** - Action failed with error message

For **simple tools**, test:
1. No params, no result
2. Partial params, no result (if applicable)
3. Full params, no result
4. Full params + result
5. Error state

### Checklist

Before committing a renderer:

- [ ] All strings use `i18n()`
- [ ] Follows state flow pattern (no params → partial params → full params → result)
- [ ] Uses `renderHeader()` for status indication
- [ ] No unnecessary borders/cards
- [ ] Consistent spacing (`space-y-3` between sections)
- [ ] Error styling is subtle (text-destructive, no red borders)
- [ ] Tested on test page with all state combinations
- [ ] Works in dark mode
- [ ] Handles undefined/missing data gracefully

## Reference Implementations

Study these for patterns:

**Simple renderers**:
- [BashRenderer.ts](../../pi-mono/packages/web-ui/src/tools/renderers/BashRenderer.ts) - Command + output pattern
- [CalculateRenderer.ts](../../pi-mono/packages/web-ui/src/tools/renderers/CalculateRenderer.ts) - Inline result pattern
- [GetCurrentTimeRenderer.ts](../../pi-mono/packages/web-ui/src/tools/renderers/GetCurrentTimeRenderer.ts) - Multiple param variations

**Complex renderers**:
- [skill.ts](../src/tools/skill.ts) - Multi-action with helper functions, custom pills
- [javascript-repl.ts](../../pi-mono/packages/web-ui/src/tools/javascript-repl.ts) - Code + output + attachments
- [browser-javascript.ts](../src/tools/browser-javascript.ts) - Similar to REPL but with skill injection
- [artifacts-tool-renderer.ts](../../pi-mono/packages/web-ui/src/tools/artifacts/artifacts-tool-renderer.ts) - Multi-command file operations with code blocks and diffs

**Helper utilities**:
- [renderer-registry.ts](../../pi-mono/packages/web-ui/src/tools/renderer-registry.ts) - renderHeader() implementation
- [DomainPill.ts](../src/components/DomainPill.ts) - Functional component example
- [SkillPill.ts](../src/components/SkillPill.ts) - Functional component with click handler
