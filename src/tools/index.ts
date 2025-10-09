import {
	BashRenderer,
	CalculateRenderer,
	createJavaScriptReplTool,
	GetCurrentTimeRenderer,
	javascriptReplTool,
	registerToolRenderer,
} from "@mariozechner/pi-web-ui";
import "./browser-javascript.js"; // Import for side effects (registers renderer)
import "./skill.js";

// Register all built-in tool renderers
registerToolRenderer("calculate", new CalculateRenderer());
registerToolRenderer("get_current_time", new GetCurrentTimeRenderer());
registerToolRenderer("bash", new BashRenderer());

// Re-export for convenience
export { createJavaScriptReplTool, javascriptReplTool };
export {
	BrowserJavaScriptTool,
	browserJavaScriptTool,
	requestUserScriptsPermission,
} from "./browser-javascript.js";
export { skillTool } from "./skill.js";
