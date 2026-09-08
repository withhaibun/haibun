import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { WEBSERVER } from "@haibun/web-server-hono/defs.js";
import { AccessLevelSchema, LinkRelations, commentDomainDefinition } from "@haibun/core/lib/resources.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains.js";
import { z } from "zod";
import ShuStepper, { sessionActions } from "./shu-stepper.js";
import { SessionAuthority, AUTHORITY_KEY } from "@haibun/core/lib/session-authority.js";
import { getStepperOptionName } from "@haibun/core/lib/util/index.js";
import { runWithRequestContext } from "@haibun/core/lib/request-context.js";
import type { TCredentialRequest } from "@haibun/core/lib/authority-types.js";


describe("the app a deployment serves", () => {
	let stepper: ShuStepper;
	let addRoute: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		stepper = new ShuStepper();
		const mounted = new Set<string>();
		addRoute = vi.fn((_type: string, path: string) => {
			if (mounted.has(path)) throw new Error(`already mounted at "${path}"`);
			mounted.add(path);
		});
		const world = getDefaultWorld();
		world.runtime[WEBSERVER] = { addRoute, mounted: { get: {} } };
		await stepper.setWorld(world, []);
	});

	it("rejects invalid mount paths", async () => {
		const result = await stepper.steps.serveShuApp.action({ path: "spa" });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected invalid mount path to fail");
		expect(result.errorMessage).toContain('path must start with "/"');
		expect(addRoute).not.toHaveBeenCalled();
	});

	it("throws on duplicate mount at same path", async () => {
		const first = await stepper.steps.serveShuApp.action({ path: "/spa" });
		expect(first.ok).toBe(true);
		expect(() => stepper.steps.serveShuApp.action({ path: "/spa" })).toThrow("already mounted");
	});
});

describe("the credential a reader acts under", () => {
	it("holds the actions the deployment named, not the letters it wrote them in", () => {
		// The option arrives as the string a deployment wrote. Taken for an array, every character of it became an
		// action: the grant then held dozens of one-letter actions and the listing of it would not validate.
		expect(sessionActions("Instance:read,comment.grant")).toEqual(["Instance:read", "comment.grant"]);
		expect(sessionActions(" Instance:read , comment.grant "), "written with spaces, as a person writes a list").toEqual(["Instance:read", "comment.grant"]);
		expect(sessionActions(undefined), "unset means nothing is issued").toEqual([]);
		expect(sessionActions(",, "), "and nothing but separators is nothing").toEqual([]);
	});

	it("gives a reader a credential over the instance it is talking to, naming the key that reader controls", async () => {
		const world = getDefaultWorld();
		const authority = new SessionAuthority();
		let asked: TCredentialRequest | undefined;
		authority.registerIssuer({
			issue: (request) => {
				asked = request;
				return Promise.resolve({ credential: { id: "urn:uuid:issued" }, keyId: "did:key:zHolder#zHolder", controller: "did:key:zHolder" });
			},
		});
		(world.runtime.keys ??= {})[AUTHORITY_KEY] = authority;
		const stepper = new ShuStepper();
		await stepper.setWorld({ ...world, moduleOptions: { [getStepperOptionName(stepper, "SESSION_CAPABILITY")]: "Instance:read,comment.grant" } }, [stepper]);
		const holderKey = { kty: "EC", crv: "P-256", x: "zX", y: "zY" };
		const issued = await runWithRequestContext({ baseIri: "http://localhost:8123" }, () =>
			(stepper.steps.issueSessionCredential.action as (args: { holderKey: unknown }) => Promise<{ products?: Record<string, unknown> }>)({ holderKey }),
		);
		expect(asked?.allowedAction, "what the deployment declared a reader may do").toEqual(["Instance:read", "comment.grant"]);
		expect(asked?.holderKey, "issued to the key the reader presented, and to nothing else").toEqual(holderKey);
		expect(asked?.target, "over the instance the reader is talking to").toBe("http://localhost:8123");
		expect(new Date(String(asked?.expires)).getTime(), "and lapsing, since a session is a sitting").toBeGreaterThan(Date.now());
		expect(issued.products?.allowedAction).toEqual(["Instance:read", "comment.grant"]);
		expect(issued.products?.keyId, "and the reader is told what its signatures are made as").toBe("did:key:zHolder#zHolder");
		// The keyId is public — it rides every signed request and is written into the credential's own record — so it
		// must not resolve as authority in its own right. A session is the key a reader holds, proven per request, not a
		// value a listing hands out: nothing a third party can read may stand in for it.
		expect(authority.resolveSession("did:key:zHolder#zHolder"), "the public keyId is not a bearer token").toEqual([]);
		expect(authority.listSessionGrants(), "and the session is not filed where a bearer token is looked up").toEqual([]);
	});

	it("refuses to give a reader anything where nothing is registered to issue it, rather than inventing a form", async () => {
		const world = getDefaultWorld();
		(world.runtime.keys ??= {})[AUTHORITY_KEY] = new SessionAuthority();
		const stepper = new ShuStepper();
		await stepper.setWorld({ ...world, moduleOptions: { [getStepperOptionName(stepper, "SESSION_CAPABILITY")]: "Instance:read" } }, [stepper]);
		const holderKey = { kty: "EC", crv: "P-256", x: "zX", y: "zY" };
		await expect(
			runWithRequestContext({ baseIri: "http://localhost:8123" }, () =>
				(stepper.steps.issueSessionCredential.action as (args: { holderKey: unknown }) => Promise<unknown>)({ holderKey }),
			),
		).rejects.toThrow(/nothing is registered to issue a credential/);
	});
});
