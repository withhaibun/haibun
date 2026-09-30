import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { SANDBOXED_HEADERS, servedSandboxed } from "./sandboxed-folder.js";

const KEPT = "kept";
const app = new Hono().use(servedSandboxed(KEPT)).get("/*", (c) => c.html("<script>alert(1)</script>"));

describe("a folder served sandboxed", () => {
	it("serves a page under it with headers that keep a script it holds from running", async () => {
		const response = await app.request(`/artifacts/seq-0/featn-1/${KEPT}/page.html`);
		for (const [name, value] of Object.entries(SANDBOXED_HEADERS)) expect(response.headers.get(name), name).toBe(value);
	});

	it("serves what isn't under it as it was", async () => {
		const response = await app.request("/artifacts/seq-0/featn-1/report.html");
		expect(response.headers.get("Content-Security-Policy")).toBeNull();
	});
});
