import { Store, type StoreConfig } from "@mariozechner/pi-web-ui";

/**
 * Store for session-scoped persistent memory.
 * Used by browser_javascript tool to store/retrieve data across tool calls.
 * Keys are scoped to sessions using the format: ${sessionId}_${key}
 */
export class MemoriesStore extends Store {
	getConfig(): StoreConfig {
		return {
			name: "memories",
		};
	}

	private makeKey(sessionId: string, key: string): string {
		return `${sessionId}_${key}`;
	}

	async get(sessionId: string, key: string): Promise<unknown | null> {
		return this.getBackend().get("memories", this.makeKey(sessionId, key));
	}

	async set(sessionId: string, key: string, value: unknown): Promise<void> {
		await this.getBackend().set("memories", this.makeKey(sessionId, key), value);
	}

	async delete(sessionId: string, key: string): Promise<void> {
		await this.getBackend().delete("memories", this.makeKey(sessionId, key));
	}

	async keys(sessionId: string): Promise<string[]> {
		const prefix = `${sessionId}_`;
		const allKeys = await this.getBackend().keys("memories", prefix);
		return allKeys.map((k) => k.substring(prefix.length));
	}

	async clear(sessionId: string): Promise<void> {
		const keys = await this.keys(sessionId);
		await this.getBackend().transaction(["memories"], "readwrite", async (tx) => {
			for (const key of keys) {
				await tx.delete("memories", this.makeKey(sessionId, key));
			}
		});
	}

	async has(sessionId: string, key: string): Promise<boolean> {
		return this.getBackend().has("memories", this.makeKey(sessionId, key));
	}
}
