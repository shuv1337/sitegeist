/**
 * Unit tests for the pure helpers exported by `src/bridge/launcher.ts`.
 *
 * The full `launchBrowser` flow spawns a real browser process and polls a
 * bridge HTTP endpoint, so it is exercised by integration / e2e tests rather
 * than here. The user-data-dir resolution rules, however, are pure and worth
 * locking in unit tests so the contract does not regress: by default we
 * isolate Shuvgeist into its own per-browser profile under `~/.shuvgeist`
 * (so the launched browser does not collide with a user's already-open
 * Chrome/Helium/Brave instance), and `useDefaultProfile` is the explicit
 * opt-out.
 */

import { describe, expect, it } from "vitest";
import { resolveUserDataDir } from "../../../src/bridge/launcher.js";

describe("resolveUserDataDir", () => {
	it("defaults to an isolated, per-browser, persistent Shuvgeist-managed directory", () => {
		expect(resolveUserDataDir({}, "chrome", "/home/example")).toBe(
			"/home/example/.shuvgeist/profile/chrome",
		);
		expect(resolveUserDataDir({}, "helium", "/home/example")).toBe(
			"/home/example/.shuvgeist/profile/helium",
		);
	});

	it("returns undefined when useDefaultProfile is set, so no --user-data-dir is passed", () => {
		expect(resolveUserDataDir({ useDefaultProfile: true }, "chrome", "/home/example")).toBeUndefined();
		// useDefaultProfile wins even if userDataDir is also set, because the
		// flag's documented intent is "share the user's real profile" and we
		// should not silently override that with a path the user happened to
		// also pass.
		expect(
			resolveUserDataDir(
				{ useDefaultProfile: true, userDataDir: "/tmp/ignored" },
				"chrome",
				"/home/example",
			),
		).toBeUndefined();
	});

	it("honors an explicit absolute userDataDir verbatim", () => {
		expect(resolveUserDataDir({ userDataDir: "/var/tmp/sg" }, "chrome", "/home/example")).toBe(
			"/var/tmp/sg",
		);
	});

	it("resolves a relative userDataDir to an absolute path", () => {
		const resolved = resolveUserDataDir(
			{ userDataDir: "relative/path" },
			"chrome",
			"/home/example",
		);
		// path.resolve makes the result absolute against the test process cwd.
		// We do not assert on the cwd portion — just that no relative prefix
		// leaks through, since Chromium rejects relative --user-data-dir args
		// silently on some platforms.
		expect(resolved?.startsWith("/")).toBe(true);
		expect(resolved?.endsWith("relative/path")).toBe(true);
	});
});
