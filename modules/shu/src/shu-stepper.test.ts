import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { WEBSERVER } from "@haibun/web-server-hono/defs.js";
import { AccessLevelSchema, LinkRelations, commentDomainDefinition } from "@haibun/core/lib/resources.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains.js";
import type { IQuadStore } from "@haibun/core/lib/quad-types.js";
import { z } from "zod";
import ShuStepper, { sessionActions } from "./shu-stepper.js";
import { SessionAuthority, AUTHORITY_KEY } from "@haibun/core/lib/session-authority.js";
import { getStepperOptionName } from "@haibun/core/lib/util/index.js";
import { runWithRequestContext } from "@haibun/core/lib/request-context.js";
import type { TCredentialRequest } from "@haibun/core/lib/authority-types.js";

function mockQuadStore(overrides: Partial<IQuadStore> = {}): IQuadStore {
	return {
		set: vi.fn(async () => undefined),
		get: vi.fn(async () => undefined),
		add: vi.fn(async () => undefined),
		query: vi.fn(async () => []),
		clear: vi.fn(async () => undefined),
		remove: vi.fn(async () => undefined),
		all: vi.fn(async () => []),
		upsertIndividual: vi.fn(async () => ""),
		getIndividual: vi.fn(async () => undefined),
		deleteIndividual: vi.fn(async () => undefined),
		queryIndividuals: vi.fn(async () => []),
		distinctPropertyValues: vi.fn(async () => []),
		getClusteredQuads: vi.fn(async () => ({ quads: [], clusters: [] })),
		...overrides,
	};
}

function selectProducts(result: Awaited<ReturnType<ShuStepper["steps"]["getSelectValues"]["action"]>>): { values: Record<string, string[]> } {
	return result.products as { values: Record<string, string[]> };
}

/** The step a serving runs at: a grant records where it was granted, so the serving carries its own seqPath. */
const servingStep = { seqPath: [0, 1, 1], in: "serve shu app", action: { stepperName: "ShuStepper", actionName: "serveShuApp", step: {}, stepValuesMap: {} } } as unknown as Parameters<typeof ShuStepper.prototype.steps.serveShuApp.action>[1];

describe("ShuStepper", () => {
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
		const result = await stepper.steps.serveShuApp.action({ path: "spa" }, servingStep);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected invalid mount path to fail");
		expect(result.errorMessage).toContain('path must start with "/"');
		expect(addRoute).not.toHaveBeenCalled();
	});

	it("throws on duplicate mount at same path", async () => {
		const first = await stepper.steps.serveShuApp.action({ path: "/spa" }, servingStep);
		expect(first.ok).toBe(true);
		expect(() => stepper.steps.serveShuApp.action({ path: "/spa" }, servingStep)).toThrow("already mounted");
	});

	it("returns no select values for Comment (no enum-backed fields)", async () => {
		const world = stepper.getWorld();
		const commentDomain = mapDefinitionsToDomains([commentDomainDefinition])[commentDomainDefinition.selectors.sort().join(" | ")];
		world.domains = { ...world.domains, comment: commentDomain };
		world.shared.getStore = vi.fn(() => mockQuadStore());

		const result = await stepper.steps.getSelectValues.action({ label: "Comment" });
		expect(result.ok).toBe(true);
		expect(selectProducts(result).values).toEqual({});
	});

	it("fails when no filter topology is registered for the label", async () => {
		const result = await stepper.steps.getSelectValues.action({ label: "Missing" });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected missing filter topology to fail");
		expect(result.errorMessage).toContain("No filter topology registered for Missing");
	});

	it("keeps context-rel select discovery in shu", async () => {
		const world = stepper.getWorld();
		world.domains = {
			...world.domains,
			email: {
				selectors: ["test-email"],
				schema: z.object({ id: z.string(), account: z.string(), folder: z.string(), accessLevel: AccessLevelSchema, dateSent: z.date() }),
				coerce: (proto: { value?: unknown }) => proto.value,
				description: "An email message.",
				topology: {
					persistedAs: "Email",
					id: "id",
					properties: {
						id: LinkRelations.IDENTIFIER.rel,
						account: LinkRelations.CONTEXT.rel,
						folder: LinkRelations.CONTEXT.rel,
						accessLevel: LinkRelations.ACCESS_LEVEL.rel,
					},
				},
			},
		};
		const distinctPropertyValues = vi.fn(async (_label: string, property: string) => (property === "account" ? ["primary"] : ["INBOX", "Sent"]));
		world.shared.getStore = vi.fn(() => mockQuadStore({ distinctPropertyValues }));

		const result = await stepper.steps.getSelectValues.action({ label: "Email" });
		expect(result.ok).toBe(true);
		expect(selectProducts(result).values).toEqual({ account: ["primary"], folder: ["INBOX", "Sent"] });
		expect(distinctPropertyValues).toHaveBeenCalledTimes(2);
	});
});

describe("the credential a reader acts under", () => {
	it("holds the actions the deployment named, not the letters it wrote them in", () => {
		// The option arrives as the string a deployment wrote. Taken for an array, every character of it became an
		// action: the grant then held dozens of one-letter actions and the listing of it would not validate.
		expect(sessionActions("Instance:read,comment.grant")).toEqual(["Instance:read", "comment.grant"]);
		expect(sessionActions(" Instance:read , comment.grant "), "written with spaces, as a person writes a list").toEqual(["Instance:read", "comment.grant"]);
		expect(sessionActions(undefined), "unset means the page carries no credential").toEqual([]);
		expect(sessionActions(",, "), "and nothing but separators is nothing").toEqual([]);
	});

	it("gives a reader a credential over the instance it is talking to, naming the key that reader controls", async () => {
		const world = getDefaultWorld();
		const authority = new SessionAuthority();
		let asked: TCredentialRequest | undefined;
		authority.registerIssuer({
			issue: (request) => {
				asked = request;
				return Promise.resolve({ credential: { id: "urn:uuid:issued" }, keyId: "did:key:zHolder#zHolder" });
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
		).rejects.toThrow(/nothing is registered to issue one/);
	});
});
