import type { NavigationMessage } from "./NavigationMessage";

export interface ContinueMessage {
	role: "continue";
}

// Extend CustomMessages interface via declaration merging
declare module "@mariozechner/pi-web-ui" {
	interface CustomMessages {
		navigation: NavigationMessage;
		continue: ContinueMessage;
	}
}