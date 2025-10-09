import { setTranslations } from "@mariozechner/mini-lit";
import { translations as webUiTranslations } from "@mariozechner/pi-web-ui";

declare module "@mariozechner/mini-lit" {
	interface i18nMessages {
		"Permission request failed": string;
		"JavaScript Execution Permission Required": string;
		"This extension needs permission to execute JavaScript code on web pages": string;
		"The browser_javascript tool allows the AI to read and interact with web pages on your behalf. This requires the userScripts permission to execute code safely and securely.": string;
		"The AI can read and modify web page content when you ask it to": string;
		"Code runs in an isolated environment with security safeguards": string;
		"Network access is blocked to prevent data exfiltration": string;
		"You can revoke this permission at any time in browser settings": string;
		"Writing JavaScript code...": string;
		"Execute JavaScript": string;
		"Preparing JavaScript...": string;
		"Getting skill": string;
		"Got skill": string;
		"Listing skills": string;
		"Creating skill": string;
		"Created skill": string;
		"Updating skill": string;
		"Updated skill": string;
		"Deleting skill": string;
		"Processing skill...": string;
		"No skills found": string;
		"Skills for domain": string;
		"Deleted skill": string;
		Examples: string;
		Library: string;
		"Command failed:": string;
		"Why is this needed?": string;
		"What this means:": string;
		"Continue Anyway": string;
		"Requesting...": string;
		"Grant Permission": string;
	}
}

const sitegeistTranslations = {
	en: {
		"Permission request failed": "Permission request failed",
		"JavaScript Execution Permission Required":
			"JavaScript Execution Permission Required",
		"This extension needs permission to execute JavaScript code on web pages":
			"This extension needs permission to execute JavaScript code on web pages",
		"The browser_javascript tool allows the AI to read and interact with web pages on your behalf. This requires the userScripts permission to execute code safely and securely.":
			"The browser_javascript tool allows the AI to read and interact with web pages on your behalf. This requires the userScripts permission to execute code safely and securely.",
		"The AI can read and modify web page content when you ask it to":
			"The AI can read and modify web page content when you ask it to",
		"Code runs in an isolated environment with security safeguards":
			"Code runs in an isolated environment with security safeguards",
		"Network access is blocked to prevent data exfiltration":
			"Network access is blocked to prevent data exfiltration",
		"You can revoke this permission at any time in browser settings":
			"You can revoke this permission at any time in browser settings",
		"Writing JavaScript code...": "Writing JavaScript code...",
		"Execute JavaScript": "Execute JavaScript",
		"Preparing JavaScript...": "Preparing JavaScript...",
		"Getting skill": "Getting skill",
		"Got skill": "Got skill",
		"Listing skills": "Listing skills",
		"Creating skill": "Creating skill",
		"Created skill": "Created skill",
		"Updating skill": "Updating skill",
		"Updated skill": "Updated skill",
		"Deleting skill": "Deleting skill",
		"Processing skill...": "Processing skill...",
		"No skills found": "No skills found",
		"Skills for domain": "Skills for domain",
		"Deleted skill": "Deleted skill",
		Examples: "Examples",
		Library: "Library",
		"Command failed:": "Command failed:",
		"Why is this needed?": "Why is this needed?",
		"What this means:": "What this means:",
		"Continue Anyway": "Continue Anyway",
		"Requesting...": "Requesting...",
		"Grant Permission": "Grant Permission",
	},
	de: {
		"Permission request failed": "Berechtigungsanfrage fehlgeschlagen",
		"JavaScript Execution Permission Required":
			"JavaScript-Ausführungsberechtigung erforderlich",
		"This extension needs permission to execute JavaScript code on web pages":
			"Diese Erweiterung benötigt die Berechtigung, JavaScript-Code auf Webseiten auszuführen",
		"The browser_javascript tool allows the AI to read and interact with web pages on your behalf. This requires the userScripts permission to execute code safely and securely.":
			"Das browser_javascript-Tool ermöglicht es der KI, Webseiten in Ihrem Auftrag zu lesen und damit zu interagieren. Dies erfordert die userScripts-Berechtigung, um Code sicher auszuführen.",
		"The AI can read and modify web page content when you ask it to":
			"Die KI kann Webseiteninhalte lesen und ändern, wenn Sie es verlangen",
		"Code runs in an isolated environment with security safeguards":
			"Code wird in einer isolierten Umgebung mit Sicherheitsvorkehrungen ausgeführt",
		"Network access is blocked to prevent data exfiltration":
			"Netzwerkzugriff ist blockiert, um Datenexfiltration zu verhindern",
		"You can revoke this permission at any time in browser settings":
			"Sie können diese Berechtigung jederzeit in den Browsereinstellungen widerrufen",
		"Writing JavaScript code...": "Schreibe JavaScript-Code...",
		"Execute JavaScript": "Führe JavaScript aus",
		"Preparing JavaScript...": "Bereite JavaScript vor...",
		"Getting skill": "Hole Skill",
		"Got skill": "Skill erhalten",
		"Listing skills": "Liste Skills auf",
		"Creating skill": "Erstelle Skill",
		"Created skill": "Skill erstellt",
		"Updating skill": "Aktualisiere Skill",
		"Updated skill": "Skill aktualisiert",
		"Deleting skill": "Lösche Skill",
		"Processing skill...": "Verarbeite Skill...",
		"No skills found": "Keine Skills gefunden",
		"Skills for domain": "Skills für Domain",
		"Deleted skill": "Skill gelöscht",
		Examples: "Beispiele",
		Library: "Bibliothek",
		"Command failed:": "Befehl fehlgeschlagen:",
		"Why is this needed?": "Warum ist das notwendig?",
		"What this means:": "Was das bedeutet:",
		"Continue Anyway": "Trotzdem fortfahren",
		"Requesting...": "Anfrage läuft...",
		"Grant Permission": "Berechtigung erteilen",
	},
};

// Merge web-ui translations with sitegeist translations
const mergedTranslations = {
	en: { ...webUiTranslations.en, ...sitegeistTranslations.en },
	de: { ...webUiTranslations.de, ...sitegeistTranslations.de },
};

setTranslations(mergedTranslations);
