import { WorkflowEngine } from "../../../src/tools/workflow-engine.js";

describe("WorkflowEngine", () => {
	it("applies exact-token substitution with type preservation and string interpolation", async () => {
		const dispatch = vi
			.fn()
			.mockResolvedValueOnce({ items: [1, 2], nested: { value: "ok" } })
			.mockResolvedValueOnce({ ok: true });
		const engine = new WorkflowEngine({ dispatch });

		const result = await engine.run({
			args: {
				titlePayload: {
					default: { label: "hello" },
				},
				script: {
					default: "return 1;",
				},
			},
			steps: [
				{
					method: "repl",
					params: {
						title: "%{titlePayload}",
						code: "%{script}",
						note: "script: %{script}",
					},
					as: "first",
				},
				{
					method: "navigate",
					params: {
						url: "%{first.items.0}",
						label: "next %{first.items.1}",
					},
				},
			],
		});

		expect(result.ok).toBe(true);
		expect(dispatch).toHaveBeenCalledTimes(2);
		expect(dispatch.mock.calls[0][1]).toEqual({
			title: { label: "hello" },
			code: "return 1;",
			note: "script: return 1;",
		});
		expect(dispatch.mock.calls[1][1]).toEqual({
			url: 1,
			label: "next 2",
		});
	});

	it("fails dry-run validation when required variables are missing", async () => {
		const engine = new WorkflowEngine({ dispatch: vi.fn() });
		const result = await engine.run(
			{
				steps: [
					{
						method: "navigate",
						params: {
							url: "%{missingUrl}",
						},
					},
				],
			},
			{ dryRun: true },
		);

		expect(result.ok).toBe(false);
		expect(result.errors.join("\n")).toContain("missing variable");
	});

	it("enforces hard loop ceilings for each loops", async () => {
		const engine = new WorkflowEngine({ dispatch: vi.fn() });
		const result = await engine.run(
			{
				args: {
					urls: {
						default: Array.from({ length: 101 }, (_v, i) => `https://example.com/${i}`),
					},
				},
				steps: [
					{
						each: "%{urls}",
						item: "url",
						steps: [
							{
								method: "navigate",
								params: { url: "%{url}" },
							},
						],
					},
				],
			},
			{ dryRun: true },
		);

		expect(result.ok).toBe(false);
		expect(result.errors.join("\n")).toContain("ceiling");
	});

	it("rejects recursive workflow methods", async () => {
		const engine = new WorkflowEngine({ dispatch: vi.fn() });
		const result = await engine.run({
			steps: [
				{
					method: "workflow_run",
					params: {},
				},
			],
		});

		expect(result.ok).toBe(false);
		expect(result.errors.join("\n")).toContain("disallowed workflow method");
	});

	it("supports onError continue while preserving failure state", async () => {
		const dispatch = vi
			.fn()
			.mockRejectedValueOnce(new Error("navigate failed"))
			.mockResolvedValueOnce({ ok: true });
		const engine = new WorkflowEngine({ dispatch });
		const result = await engine.run({
			steps: [
				{
					method: "navigate",
					params: { url: "https://example.com" },
					onError: "continue",
				},
				{
					method: "repl",
					params: { title: "ok", code: "return 1;" },
				},
			],
		});

		expect(result.ok).toBe(false);
		expect(dispatch).toHaveBeenCalledTimes(2);
		expect(result.steps.some((step) => step.status === "ok" && step.method === "repl")).toBe(true);
	});

	it("returns partial results on abort", async () => {
		const controller = new AbortController();
		const dispatch = vi.fn(async (method: string) => {
			if (method === "navigate") {
				return { page: "ok" };
			}
			controller.abort();
			throw new Error("aborted");
		});
		const engine = new WorkflowEngine({ dispatch });
		const result = await engine.run(
			{
				steps: [
					{
						method: "navigate",
						params: { url: "https://example.com" },
						as: "page",
					},
					{
						method: "repl",
						params: { title: "next", code: "return 1;" },
					},
				],
			},
			{ signal: controller.signal },
		);

		expect(result.aborted).toBe(true);
		expect(result.steps.some((step) => step.method === "navigate" && step.status === "ok")).toBe(true);
		expect(result.steps.some((step) => step.method === "repl" && step.status === "aborted")).toBe(true);
		expect(result.captured.page).toEqual({ page: "ok" });
	});

	it("truncates oversized step payloads predictably", async () => {
		const dispatch = vi.fn().mockResolvedValue("x".repeat(40));
		const engine = new WorkflowEngine({
			dispatch,
			maxStepResultChars: 10,
		});
		const result = await engine.run({
			steps: [
				{
					method: "repl",
					params: { title: "t", code: "return 1;" },
				},
			],
		});

		expect(result.ok).toBe(true);
		const step = result.steps.find((entry) => entry.method === "repl");
		expect(typeof step?.result).toBe("string");
		expect(step?.result).toContain("[truncated");
	});
});
