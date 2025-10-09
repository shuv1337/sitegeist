import { Store, type StoreConfig } from "@mariozechner/pi-web-ui";

export interface UserPrompt {
	id: string;
	name: string;
	prompt: string;
	tags: string[];
	createdAt: string;
	lastUsed?: string;
}

/**
 * Store for user-defined prompts (future feature).
 */
export class PromptsStore extends Store {
	getConfig(): StoreConfig {
		return {
			name: "user-prompts",
			keyPath: "id",
		};
	}

	async get(id: string): Promise<UserPrompt | null> {
		return this.getBackend().get("user-prompts", id);
	}

	async save(prompt: UserPrompt): Promise<void> {
		await this.getBackend().set("user-prompts", prompt.id, prompt);
	}

	async delete(id: string): Promise<void> {
		await this.getBackend().delete("user-prompts", id);
	}

	async list(): Promise<UserPrompt[]> {
		const keys = await this.getBackend().keys("user-prompts");
		const prompts = await Promise.all(
			keys.map((key) => this.getBackend().get<UserPrompt>("user-prompts", key)),
		);
		return prompts.filter((p): p is UserPrompt => p !== null);
	}
}
