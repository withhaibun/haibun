import { describe, it, expect } from "vitest";
import { ServerUnreachable } from "@haibun/core/lib/rpc-wire.js";
import { openPage, type TOpenPageScope } from "./open-page.js";
import type { TPageAuthority } from "../authority/pipelines/page-authority.js";

const AUTHORITY: TPageAuthority = { controller: "did:key:zReader", delegations: [], records: undefined, withoutDelegation: [] };

/** A scope whose calls are recorded, with `over` in place of the kit's. */
function scopeWith(over: Partial<TOpenPageScope>): { scope: TOpenPageScope; calls: string[] } {
	const calls: string[] = [];
	const scope: TOpenPageScope = {
		carried: false,
		arrivedWithAddress: false,
		openAuthority: () => {
			calls.push("authority");
			return Promise.resolve(AUTHORITY);
		},
		mayRead: () => true,
		delegateFromEmbedder: undefined,
		readSteps: () => {
			calls.push("steps");
			return Promise.resolve([]);
		},
		connect: () => void calls.push("connect"),
		followTurns: () => void calls.push("turns"),
		viewsShown: () => Promise.resolve(["shu-monitor-column"]),
		pageBuild: () => "haibun 4.0.0, page code built 2026-09-30T12:00:00.000Z",
		...over,
	};
	return { scope, calls };
}

describe("opening the page", () => {
	it("reads the reader's authority before actuality's steps, connects the stream, and shows actuality's views to a reader without an address", async () => {
		const { scope, calls } = scopeWith({});
		expect(await openPage(scope)).toEqual({ status: "opened", shown: ["shu-monitor-column"] });
		expect(calls).toEqual(["authority", "steps", "connect", "turns"]);
	});

	it("keeps the reader's own arrangement where the address names views", async () => {
		expect(await openPage(scopeWith({ arrivedWithAddress: true }).scope)).toEqual({ status: "opened", shown: [] });
	});

	it("stops at the page's key where the reader may not read, before it reads actuality's steps", async () => {
		const { scope, calls } = scopeWith({ mayRead: () => false });
		expect(await openPage(scope)).toEqual({ status: "keyed", controller: AUTHORITY.controller });
		expect(calls).toEqual(["authority"]);
	});

	it("states why a served page didn't open, with the build of its code", async () => {
		const { scope } = scopeWith({ readSteps: () => Promise.reject(new Error("the site refused the read")) });
		expect(await openPage(scope)).toEqual({ status: "failed", reason: "the site refused the read", build: "haibun 4.0.0, page code built 2026-09-30T12:00:00.000Z" });
	});

	it("opens a page that carries a record without the site's registry, and fails one whose steps fail otherwise", async () => {
		const unreachable = scopeWith({ carried: true, readSteps: () => Promise.reject(new ServerUnreachable("showSteps", new Error("not served"))) });
		expect(await openPage(unreachable.scope)).toEqual({ status: "opened", shown: ["shu-monitor-column"] });
		expect(unreachable.calls, "a carried page doesn't read authority or connect a stream").toEqual([]);
		const broken = scopeWith({ carried: true, readSteps: () => Promise.reject(new Error("the record's registry doesn't match its schema")) });
		expect((await openPage(broken.scope)).status).toBe("failed");
	});
});
