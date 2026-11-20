/** The browser's domains: the ways a step locates an element, what reading a page and a response returns, the HTTP and network records the page's observer keeps, and the options a step takes. */
import { AS_APPLICATION, AS_SERVICE, FOAF_DOCUMENT, HTTP_REQUEST, NAMESPACE, PROV_ENTITY, SCHEMA_WEB_PAGE } from "@haibun/core/lib/domains/vocabularies.js";
import { HYPERMEDIA } from "@haibun/core/lib/domains/protocol.js";
import { RecordSchema, RecordsSchema } from "@haibun/core/lib/domains/json-text.js";
import { listOf } from "@haibun/core/lib/domains/lists.js";
import { CountedFields } from "@haibun/core/lib/domains/hypermedia.js";
import { z } from "zod";
import { DOMAIN_LINK, DOMAIN_NUMBER, DOMAIN_STRING, DOMAIN_TEXT, createEnumDomainDefinition, globSource, NameSchema, unionDomainKey } from "@haibun/core/lib/domains/domains.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import {
	Access,
	ENDPOINT_LABEL,
	HTTP_CLIENT_LABEL,
	HTTP_HOST_LABEL,
	HTTP_REQUEST_LABEL,
	LinkRelations,
	PersistedVertexSchema,
	TDomainDefinition,
	ENDPOINT_CLASS,
	type TSourceProperty,
} from "@haibun/core/lib/domains/resources.js";
import {
	BrowserTabSchema,
	BrowserTabTextSchema,
	BrowserTabsSchema,
	DOMAIN_BROWSER_TAB,
	DOMAIN_BROWSER_TABS,
	DOMAIN_BROWSER_TAB_TEXT,
	DOMAIN_RELAY_ATTACHMENT,
	RelayAttachmentSchema,
} from "./relay.js";

/** Every tab open in the attached browser, as a counted list. */
const BrowserTabsListSchema = BrowserTabsSchema.extend(CountedFields);
/** What the relay holds, with the count of its tabs. */
const RelayAttachmentListSchema = RelayAttachmentSchema.extend(CountedFields);

/** A page the browser opened by navigation. */
export const VISITED_PAGE_LABEL = "VisitedPage";

export const DOMAIN_PAGE_LOCATOR = "page-locator";
export const DOMAIN_PAGE_TEST_ID = "page-test-id";
const DOMAIN_PAGE_LABEL = "page-label";
export const DOMAIN_PAGE_PLACEHOLDER = "page-placeholder";
const DOMAIN_PAGE_ROLE = "page-role";
const DOMAIN_PAGE_TITLE = "page-title";
const DOMAIN_PAGE_ALT_TEXT = "page-alt-text";
/** Text a page shows, located by `getByText` with an exact match. */
export const DOMAIN_PAGE_TEXT = "page-text";
/** The ways a step locates an element on a page, in the order a union of locator domains selects one. Each row holds the
 *  locator domain whose values it locates, the way a click by way names it, the Playwright method that locates it, whether a
 *  value of its domain matches the element's whole text, and the prefix the method's argument takes. The row of a Playwright
 *  selector doesn't name a way, and the row of a reference an accessibility snapshot names doesn't name a domain. */
export const PAGE_LOCATORS = [
	{ domain: DOMAIN_PAGE_TEXT, way: "text", method: "getByText", exact: true, prefix: "" },
	{ domain: DOMAIN_PAGE_TEST_ID, way: "test id", method: "getByTestId", exact: false, prefix: "" },
	{ domain: DOMAIN_PAGE_LABEL, way: "label", method: "getByLabel", exact: false, prefix: "" },
	{ domain: DOMAIN_PAGE_PLACEHOLDER, way: "placeholder", method: "getByPlaceholder", exact: false, prefix: "" },
	{ domain: DOMAIN_PAGE_ROLE, way: "role", method: "getByRole", exact: false, prefix: "" },
	{ domain: DOMAIN_PAGE_TITLE, way: "title", method: "getByTitle", exact: false, prefix: "" },
	{ domain: DOMAIN_PAGE_ALT_TEXT, way: "alt text", method: "getByAltText", exact: false, prefix: "" },
	{ domain: DOMAIN_PAGE_LOCATOR, way: undefined, method: "locator", exact: false, prefix: "" },
	{ domain: undefined, way: "reference", method: "locator", exact: false, prefix: "aria-ref=" },
] as const;
export type TPageLocator = (typeof PAGE_LOCATORS)[number];
/** A row of `PAGE_LOCATORS` that locates the values of a domain. */
export type TDomainLocator = Extract<TPageLocator, { domain: string }>;
/** A row of `PAGE_LOCATORS` that a click by way names. */
export type TWayLocator = Extract<TPageLocator, { way: string }>;
export type TFindWay = TWayLocator["way"];
export const isDomainLocator = (row: TPageLocator): row is TDomainLocator => row.domain !== undefined;
const isWayLocator = (row: TPageLocator): row is TWayLocator => row.way !== undefined;
const PAGE_LOCATOR_DOMAINS = PAGE_LOCATORS.filter(isDomainLocator).map(({ domain }) => domain);
/** The row of `PAGE_LOCATORS` whose domain the key names. Every locator domain has one. */
function locateRow(domain: string): TDomainLocator {
	const found = PAGE_LOCATORS.filter(isDomainLocator).find((row) => row.domain === domain);
	if (found === undefined) throw new Error(`web-playwright doesn't locate values of ${domain}: the rows of PAGE_LOCATORS don't name its domain`);
	return found;
}
/** The ways to find what a click presses, each a way to read the page. */
export const WAY_LOCATORS = PAGE_LOCATORS.filter(isWayLocator);
/** An element on a page, identified by a value of any locator domain. A literal is page text. */
export const DOMAIN_PAGE_TARGET = unionDomainKey(PAGE_LOCATOR_DOMAINS);
/** A page of the browser actuality drives, addressed by the number of its tab: `BrowserPage:0.uri`, `BrowserPage:0.cookie.session`. */
export const DOMAIN_BROWSER_PAGE = "browser-page";

/** The most bytes a property read of a page's or an element's text may copy into Node. A larger text is checked at the page. */
const TEXT_MAX_BYTES = 4 * 1024 * 1024;
/** The most bytes an element's attribute value may hold for a read into Node. */
const ATTRIBUTE_MAX_BYTES = 4 * 1024;

/** The way a row of `PAGE_LOCATORS` locates, held structurally so the property readers don't name Playwright to this module. */
export type TLocatorMode = { method: string; prefix: string; exact: boolean };
/** What a text comparison checked in the page returned: whether the expected value holds, and the text's length in bytes. Only these cross to Node. */
export type TTextVerdict = { holds: boolean; byteLength: number };
/** The browser actuality drives, as the property readers of the locator domains and of `browser-page` reach it: located by the
 *  way a row names, within the container `in {container}, {what}` scopes a statement to, and by tab for a page a feature names
 *  with a CURIE. The web stepper publishes it on the world's runtime under `WEB_PAGES` as each feature starts. */
export type TBrowserPages = {
	/** How many elements the target locates, right now, where a step finds elements. */
	matches(mode: TLocatorMode, target: string): Promise<number>;
	/** Whether the first element the target locates shows, right now: false where it is detached, hidden, or not there. */
	isVisible(mode: TLocatorMode, target: string): Promise<boolean>;
	/** The first element's text, or undefined where the element isn't there or its text is empty. */
	textOf(mode: TLocatorMode, target: string): Promise<string | undefined>;
	/** Checks the first element's text against the expected value at the page: `operator` is one of is, contains,
	 *  matches, the pattern given as its glob. Returns undefined where the element isn't there. */
	checkText(mode: TLocatorMode, target: string, operator: string, expected: string): Promise<TTextVerdict | undefined>;
	/** The first element's form value, or undefined where the element isn't there or its value is absent. */
	valueOf(mode: TLocatorMode, target: string): Promise<string | undefined>;
	/** The first element's attribute named `name`, or undefined where the element isn't there or lacks the attribute. */
	attributeOf(mode: TLocatorMode, target: string, name: string): Promise<string | undefined>;
	/** The address of the page of the tab, or undefined where the tab doesn't hold a page. */
	uri(tab: number): Promise<string | undefined>;
	/** The title of the page of the tab, read at the page. */
	title(tab: number): Promise<string | undefined>;
	/** The value of the feature's context cookie named `name`, or undefined where the context doesn't hold it. */
	cookie(tab: number, name: string): Promise<string | undefined>;
	/** The value of the page's address query parameter named `name`, or undefined where the address lacks it or the tab doesn't hold a page. */
	query(tab: number, name: string): Promise<string | undefined>;
};

/** The runtime key of the browser pages port. */
export const WEB_PAGES = "web-playwright-pages";

/** The browser pages of the actuality that loaded a web stepper. Throws naming what to run where a feature read a page
 *  before the web stepper started it, the way the FilePath readers refuse a feature that didn't load a storage. */
function webPagesOf(world: TWorld, subject: unknown): TBrowserPages {
	const pages = (world.runtime as Record<string, unknown>)[WEB_PAGES] as TBrowserPages | undefined;
	if (pages === undefined) throw new Error(`${String(subject)} can't be read: actuality doesn't hold a browser; run a feature whose steppers include WebPlaywright.`);
	return pages;
}

const tabOf = (subject: unknown): number => Number(subject);

/** The way a property reads the elements of a row of `PAGE_LOCATORS`. */
const modeOf = ({ method, prefix, exact }: TDomainLocator): TLocatorMode => ({ method, prefix, exact });
/** Returns `value` as a string, or an empty string when absent. */
const emptyOr = (value: string | null | undefined): string => (value === undefined || value === null ? "" : value);

/** Returns the first subpath key, or an empty string when omitted. */
const subkeyOf = (subpath?: readonly unknown[]): string => (subpath?.[0] === undefined || subpath[0] === null ? "" : String(subpath[0]));

/** The properties of a locator domain, reading the elements located by the mode the subject selects. */
function locatorProperties(modeFor: (subject: unknown) => TLocatorMode): Record<string, TSourceProperty> {
	const text = async (subject: unknown, world: TWorld): Promise<{ text: string; byteLength: number } | undefined> => {
		const value = await webPagesOf(world, subject).textOf(modeFor(subject), String(subject));
		return value === undefined ? undefined : { text: value, byteLength: new TextEncoder().encode(value).length };
	};
	return {
		text: {
			domain: DOMAIN_TEXT,
			maxBytes: TEXT_MAX_BYTES,
			read: async (subject, world) => {
				const read = await text(subject, world);
				if (read === undefined) throw new Error(`the element ${String(subject)} doesn't hold text to read`);
				return read.text;
			},
			evaluate: async (subject, operator, expected, world) => {
				if (operator === "exists") return { matches: (await webPagesOf(world, subject).matches(modeFor(subject), String(subject))) > 0, byteLength: 0 };
				const verdict = await webPagesOf(world, subject).checkText(modeFor(subject), String(subject), operator, String(expected));
				// An element that isn't there holds empty text: the comparison fails without waiting out the step's timeout.
				return verdict === undefined ? { matches: false, byteLength: 0 } : { matches: verdict.holds, byteLength: verdict.byteLength };
			},
		},
		value: {
			domain: DOMAIN_STRING,
			maxBytes: TEXT_MAX_BYTES,
			read: async (subject, world) => emptyOr(await webPagesOf(world, subject).valueOf(modeFor(subject), String(subject))),
		},
		visible: {
			domain: "boolean",
			maxBytes: 8,
			read: (subject, world) => webPagesOf(world, subject).isVisible(modeFor(subject), String(subject)),
			evaluate: async (subject, operator, expected, world) => {
				const count = await webPagesOf(world, subject).matches(modeFor(subject), String(subject));
				if (operator === "exists") return { matches: count > 0, byteLength: 0 };
				if (operator === "is" && count === 0) return { matches: String(expected) === "false", byteLength: 5 };
				if (operator === "is") return { matches: (await webPagesOf(world, subject).isVisible(modeFor(subject), String(subject))) === (String(expected) === "true"), byteLength: 5 };
				return undefined;
			},
		},
		count: {
			domain: DOMAIN_NUMBER,
			maxBytes: 32,
			read: (subject, world) => webPagesOf(world, subject).matches(modeFor(subject), String(subject)),
			evaluate: async (subject, operator, expected, world) => {
				const count = await webPagesOf(world, subject).matches(modeFor(subject), String(subject));
				const byteLength = String(count).length;
				if (operator === "exists") return { matches: count > 0, byteLength };
				if (operator === "is") return { matches: count === Number(expected), byteLength };
				if (operator === "isLessThan") return { matches: count < Number(expected), byteLength };
				if (operator === "isMoreThan") return { matches: count > Number(expected), byteLength };
				return undefined;
			},
		},
		attribute: {
			domain: DOMAIN_STRING,
			keyed: true,
			maxBytes: ATTRIBUTE_MAX_BYTES,
			read: async (subject, world, subpath) => emptyOr(await webPagesOf(world, subject).attributeOf(modeFor(subject), String(subject), subkeyOf(subpath))),
			evaluate: async (subject, operator, _expected, world, subpath) => {
				if (operator !== "exists") return undefined;
				const value = await webPagesOf(world, subject).attributeOf(modeFor(subject), String(subject), subkeyOf(subpath));
				return { matches: value !== undefined, byteLength: value === undefined ? 0 : new TextEncoder().encode(value).length };
			},
		},
	};
}

/** The properties of the values of one locator domain, read by the row of `PAGE_LOCATORS` that locates them. */
const locatorRowProperties = (domain: string) => {
	const mode = modeOf(locateRow(domain));
	return locatorProperties(() => mode);
};
/** The row a subject of the page-target union locates: a bare word names a test id, a value Playwright reads as a
 *  selector locates by css, and anything else names the text the page shows. */
function unionLocatorRow(subject: unknown): TDomainLocator {
	const value = String(subject);
	if (/^[\p{L}_][\p{L}\p{N}-]*$/u.test(value)) return locateRow(DOMAIN_PAGE_TEST_ID);
	if (/^[#.[:*>~|]/.test(value)) return locateRow(DOMAIN_PAGE_LOCATOR);
	return locateRow(DOMAIN_PAGE_TEXT);
}

/** The readable properties of the `browser-page` domain: the page of the tab the subject numbers. Comparisons evaluate at
 *  the page, so only the verdict and the byte length cross to Node. */
const browserPageProperties: Record<string, TSourceProperty> = {
	uri: {
		domain: DOMAIN_LINK,
		maxBytes: 8 * 1024,
		read: (subject, world) => webPagesOf(world, subject).uri(tabOf(subject)),
		evaluate: async (subject, operator, expected, world) => {
			const uri = await webPagesOf(world, subject).uri(tabOf(subject));
			const byteLength = uri === undefined ? 0 : new TextEncoder().encode(uri).length;
			if (operator === "exists") return { matches: uri !== undefined, byteLength };
			if (operator === "is") return { matches: uri === String(expected), byteLength };
			if (operator === "matches") return { matches: uri !== undefined && new RegExp(globSource(String(expected)), "s").test(uri), byteLength };
			return undefined;
		},
	},
	title: {
		domain: DOMAIN_TEXT,
		maxBytes: 4 * 1024,
		read: (subject, world) => webPagesOf(world, subject).title(tabOf(subject)),
		evaluate: async (subject, operator, expected, world) => {
			const title = await webPagesOf(world, subject).title(tabOf(subject));
			const byteLength = title === undefined ? 0 : new TextEncoder().encode(title).length;
			if (operator === "exists") return { matches: title !== undefined, byteLength };
			if (operator === "is") return { matches: title === String(expected), byteLength };
			if (operator === "contains") return { matches: title !== undefined && title.includes(String(expected)), byteLength };
			if (operator === "matches") return { matches: title !== undefined && new RegExp(globSource(String(expected)), "s").test(title), byteLength };
			return undefined;
		},
	},
	cookie: {
		domain: DOMAIN_STRING,
		keyed: true,
		maxBytes: 8 * 1024,
		read: (subject, world, subpath) => webPagesOf(world, subject).cookie(tabOf(subject), subkeyOf(subpath)),
		evaluate: async (subject, operator, expected, world, subpath) => {
			const value = await webPagesOf(world, subject).cookie(tabOf(subject), subkeyOf(subpath));
			const byteLength = value === undefined ? 0 : new TextEncoder().encode(value).length;
			if (operator === "exists") return { matches: value !== undefined, byteLength };
			if (operator === "is") return { matches: value === String(expected), byteLength };
			if (operator === "contains") return { matches: value !== undefined && value.includes(String(expected)), byteLength };
			return undefined;
		},
	},
	query: {
		domain: DOMAIN_STRING,
		keyed: true,
		maxBytes: 8 * 1024,
		read: (subject, world, subpath) => webPagesOf(world, subject).query(tabOf(subject), subkeyOf(subpath)),
		evaluate: async (subject, operator, expected, world, subpath) => {
			const value = await webPagesOf(world, subject).query(tabOf(subject), subkeyOf(subpath));
			const byteLength = value === undefined ? 0 : new TextEncoder().encode(value).length;
			if (operator === "exists") return { matches: value !== undefined, byteLength };
			if (operator === "is") return { matches: value === String(expected), byteLength };
			if (operator === "contains") return { matches: value !== undefined && value.includes(String(expected)), byteLength };
			return undefined;
		},
	},
};
/** A key as Playwright names it, such as Enter or Control+A. */
export const DOMAIN_KEYBOARD_KEY = "keyboard-key";
/** A media type, such as application/json. */
export const DOMAIN_MEDIA_TYPE = "media-type";
/** A property of a JSON response's members, by name. */

const locatorSchema = z.string().min(1, "locator cannot be empty");
const AccessibilitySnapshotSchema = z.object({
	url: z.string(),
	title: z.string(),
	snapshot: z.string().describe("The page's aria snapshot, in YAML, each element with its reference, such as [ref=e2]."),
	[HYPERMEDIA.LINKS]: z.record(z.string(), z.object({ method: z.string() }).strict()),
});
/** The members of the last JSON response, as a counted list. */
const JsonResponseListSchema = z.object({ members: RecordsSchema, ...CountedFields });
/** The domains of what reading a page and a JSON response return. */
export const DOMAIN_ACCESSIBILITY_SNAPSHOT = "accessibility-snapshot";
export const DOMAIN_JSON_RESPONSE = "json-response";
/** A response an HTTP step returns as its product. */
export const DOMAIN_HTTP_RESPONSE = "http-response";
/** The domain of an extension loaded into the browser actuality launches: its id and the origin of its pages. */
export const DOMAIN_BROWSER_EXTENSION = "browser-extension";
const BrowserExtensionSchema = z.object({ id: z.string(), origin: z.string() });
/** The domain of an extension the browser runs: its worker, where it declares one, and the side panel its toolbar button
 *  opens, where it declares one. */
export const DOMAIN_RUNNING_BROWSER_EXTENSION = "running-browser-extension";
const RunningBrowserExtensionSchema = BrowserExtensionSchema.extend({
	worker: z.string().optional(),
	sidePanel: z.object({ path: z.string(), opensOnAction: z.boolean() }).optional(),
});

const HTTP_NS = { http: NAMESPACE.http };
const httpRequestSchema = PersistedVertexSchema.extend({
	id: z.string(),
	method: z.string().optional(),
	status: z.number().optional(),
	durationMs: z.number().optional(),
	url: z.string().optional(),
	endpointClass: z.enum([ENDPOINT_CLASS.route, ENDPOINT_CLASS.service, ENDPOINT_CLASS.external]).optional(),
	generatedAtTime: z.string(),
});
const httpClientSchema = PersistedVertexSchema.extend({ id: z.string(), name: z.string().optional(), generatedAtTime: z.string() });
const httpHostSchema = PersistedVertexSchema.extend({ id: z.string(), name: z.string().optional(), requestCount: z.number().optional(), generatedAtTime: z.string() });
/** A navigation of a page of actuality: the page by its key among actuality's pages, the navigation's ordinal on that page, and the
 *  address it reached as its name. The store derives its id from its keys. */
const visitedPageSchema = PersistedVertexSchema.extend({ id: z.string(), page: z.string(), navigation: z.number(), name: z.string().optional(), generatedAtTime: z.string() });

/** The HTTP methods a request is made with: those that send a body, and those that don't. */
export const HTTP_METHODS_WITH_BODY = ["POST", "PUT", "PATCH"] as const;
const HTTP_METHODS_WITHOUT_BODY = ["GET", "DELETE", "HEAD"] as const;
export const DOMAIN_HTTP_METHOD = "http-method";
export const DOMAIN_HTTP_METHOD_WITH_BODY = "http-method-with-body";
export const DOMAIN_HTTP_METHOD_WITHOUT_BODY = "http-method-without-body";
export const DOMAIN_FIND_WAY = "page-find-way";
/** The fate of the requests a page makes to a URL: refused, held without a response, or allowed. */
export const REQUEST_STATE = { blocked: "blocked", unanswered: "unanswered", allowed: "allowed" } as const;
export const DOMAIN_REQUEST_STATE = "request-state";
/** The browsers actuality drives. */
const BROWSER_TYPES = ["firefox", "chromium", "webkit"] as const;
export type TBrowserTypes = (typeof BROWSER_TYPES)[number];
export const DOMAIN_BROWSER_TYPE = "browser-type";
/** A URL pattern as a page routes requests by it: `*` within a path segment, `**` across segments. */
export const DOMAIN_URL_GLOB = "url-glob";

/** A JSON response's body: a record, or a list of records. */
export const JsonResponseSchema = z.union([RecordSchema, RecordsSchema]);
export type TJsonResponse = z.infer<typeof JsonResponseSchema>;

/** A response as a step captured it, which actuality keeps as JSON text in a variable. */
export const CapturedResponseSchema = z.object({
	status: z.number(),
	statusText: z.string(),
	headers: z.record(z.string(), z.string()),
	url: z.string(),
	/** The body read as JSON, absent where it isn't JSON. */
	json: JsonResponseSchema.optional(),
	text: z.string(),
	/** Where actuality keeps a binary response's bytes, absent where the body is text. */
	contentUrl: z.string().optional(),
	/** The media type of a binary response's bytes, absent where the body is text. */
	encodingFormat: z.string().optional(),
});
export type TCapturedResponse = z.infer<typeof CapturedResponseSchema>;

/** The schemes an Authorization header sends credentials under: Basic, as user:password (RFC 7617), and Bearer, as a token (RFC 6750). */
export const AUTHORIZATION_SCHEMES = { basic: "Basic", bearer: "Bearer" } as const;
export type TAuthorizationScheme = (typeof AUTHORIZATION_SCHEMES)[keyof typeof AUTHORIZATION_SCHEMES];
export const DOMAIN_AUTHORIZATION_SCHEME = "authorization-scheme";
export const DOMAIN_AUTHORIZATION_CREDENTIALS = "authorization-credentials";

declare module "@haibun/core/lib/domains/domains.js" {
	/** The value each browser domain coerces. A union of locator domains is a page target, whose parameter receives the
	 *  resolved TStepValue. */
	interface DomainTypes {
		[DOMAIN_HTTP_METHOD]: (typeof HTTP_METHODS_WITHOUT_BODY)[number] | (typeof HTTP_METHODS_WITH_BODY)[number];
		[DOMAIN_HTTP_METHOD_WITH_BODY]: (typeof HTTP_METHODS_WITH_BODY)[number];
		[DOMAIN_HTTP_METHOD_WITHOUT_BODY]: (typeof HTTP_METHODS_WITHOUT_BODY)[number];
		[DOMAIN_FIND_WAY]: TFindWay;
		[DOMAIN_REQUEST_STATE]: (typeof REQUEST_STATE)[keyof typeof REQUEST_STATE];
		[DOMAIN_BROWSER_TYPE]: TBrowserTypes;
		[DOMAIN_BROWSER_PAGE]: number;
		[DOMAIN_AUTHORIZATION_SCHEME]: TAuthorizationScheme;
		[DOMAIN_AUTHORIZATION_CREDENTIALS]: z.output<typeof NameSchema>;
		[DOMAIN_URL_GLOB]: z.output<typeof NameSchema>;
		[DOMAIN_KEYBOARD_KEY]: z.output<typeof NameSchema>;
		[DOMAIN_MEDIA_TYPE]: z.output<typeof MediaTypeSchema>;
		[DOMAIN_PAGE_LOCATOR]: z.output<typeof locatorSchema>;
		[DOMAIN_PAGE_TEXT]: z.output<typeof locatorSchema>;
		[DOMAIN_PAGE_TEST_ID]: z.output<typeof locatorSchema>;
		[DOMAIN_PAGE_LABEL]: z.output<typeof locatorSchema>;
		[DOMAIN_PAGE_PLACEHOLDER]: z.output<typeof locatorSchema>;
		[DOMAIN_PAGE_ROLE]: z.output<typeof locatorSchema>;
		[DOMAIN_PAGE_TITLE]: z.output<typeof locatorSchema>;
		[DOMAIN_PAGE_ALT_TEXT]: z.output<typeof locatorSchema>;
	}
}

/** What a media type matches: a type and a subtype joined by a slash. */
const MediaTypeSchema = z.string().regex(/^[\w.+-]+\/[\w.+*-]+/, "isn't a media type");

export const WebPlaywrightDomains: TDomainDefinition[] = [
	createEnumDomainDefinition({ name: DOMAIN_HTTP_METHOD, values: [...HTTP_METHODS_WITHOUT_BODY, ...HTTP_METHODS_WITH_BODY], description: "An HTTP method a request is made with" }),
	createEnumDomainDefinition({ name: DOMAIN_HTTP_METHOD_WITH_BODY, values: [...HTTP_METHODS_WITH_BODY], description: "An HTTP method whose request sends a body" }),
	createEnumDomainDefinition({ name: DOMAIN_HTTP_METHOD_WITHOUT_BODY, values: [...HTTP_METHODS_WITHOUT_BODY], description: "An HTTP method whose request doesn't send a body" }),
	createEnumDomainDefinition({
		name: DOMAIN_FIND_WAY,
		values: WAY_LOCATORS.map(({ way }) => way),
		description: "A way to find what a click presses; a reference is one an accessibility snapshot names, such as e2",
	}),
	createEnumDomainDefinition({
		name: DOMAIN_REQUEST_STATE,
		values: Object.values(REQUEST_STATE),
		description: "Whether the requests a page makes are refused, held without a response, or allowed",
	}),
	createEnumDomainDefinition({ name: DOMAIN_BROWSER_TYPE, values: [...BROWSER_TYPES], description: "A browser actuality drives" }),
	createEnumDomainDefinition({
		name: DOMAIN_AUTHORIZATION_SCHEME,
		values: Object.values(AUTHORIZATION_SCHEMES),
		description: "The scheme an Authorization header sends credentials under",
	}),
	{
		selectors: [DOMAIN_AUTHORIZATION_CREDENTIALS],
		schema: NameSchema,
		description: "The credentials an Authorization header sends: user:password under Basic, and the token under Bearer. They grant their holder the access they carry.",
	},
	{ selectors: [DOMAIN_URL_GLOB], schema: NameSchema, description: "A URL pattern as a page routes requests by it: * within a path segment, ** across segments" },
	{ selectors: [DOMAIN_ACCESSIBILITY_SNAPSHOT], schema: AccessibilitySnapshotSchema, description: "A page as its accessibility tree reads, with the steps that act on it" },
	{ selectors: [DOMAIN_JSON_RESPONSE], schema: JsonResponseListSchema, list: listOf(JsonResponseListSchema, "members"), description: "The members of the last JSON response" },
	{
		selectors: [DOMAIN_BROWSER_EXTENSION],
		schema: BrowserExtensionSchema,
		description: "An extension loaded into the browser actuality launches, and the origin its pages are at",
	},
	{
		selectors: [DOMAIN_RUNNING_BROWSER_EXTENSION],
		schema: RunningBrowserExtensionSchema,
		description: "An extension the browser runs: its worker, and the side panel its toolbar button opens",
	},
	{
		selectors: [DOMAIN_RELAY_ATTACHMENT],
		schema: RelayAttachmentListSchema,
		list: listOf(RelayAttachmentListSchema, "tabs"),
		description: "What the browser relay holds: a person's attached browser, its holder and its tabs",
	},
	{ selectors: [DOMAIN_BROWSER_TAB], schema: BrowserTabSchema, description: "A tab open in the attached browser: its id, title and address" },
	{ selectors: [DOMAIN_BROWSER_TABS], schema: BrowserTabsListSchema, list: listOf(BrowserTabsListSchema, "tabs"), description: "Every tab open in the attached browser" },
	{ selectors: [DOMAIN_BROWSER_TAB_TEXT], schema: BrowserTabTextSchema, description: "A tab of the attached browser and the text its page shows" },
	{
		selectors: [HTTP_REQUEST_LABEL],
		schema: httpRequestSchema,
		description: "An HTTP request observed on the network: one record of a client, the site, or an external host exchanging a message.",
		topology: {
			persistedAs: HTTP_REQUEST_LABEL,
			accessLevel: Access.private,
			instrumentation: true,
			observesActuality: true,
			type: HTTP_REQUEST,
			id: "id",
			namespaces: HTTP_NS,
			properties: {
				id: LinkRelations.IDENTIFIER.rel,
				method: LinkRelations.TAG.rel,
				status: LinkRelations.TAG.rel,
				durationMs: LinkRelations.TAG.rel,
				url: LinkRelations.URL.rel,
				endpointClass: LinkRelations.TAG.rel,
			},
			// The browser performs a request, or the site does where it requests something itself; a request targets the
			// endpoint of this site it reached, or the external host that received it.
			edges: {
				performedBy: { rel: LinkRelations.PERFORMED_BY.rel, range: [HTTP_CLIENT_LABEL, HTTP_HOST_LABEL] },
				target: { rel: LinkRelations.AS_TARGET.rel, range: [ENDPOINT_LABEL, HTTP_HOST_LABEL], reference: true },
			},
			// This type doesn't declare a displayLabel: the id ("GET /path") is the title; status and duration are fields, not a stored summary copy.
		},
	},
	{
		selectors: [HTTP_CLIENT_LABEL],
		schema: httpClientSchema,
		description: "The requesting party: the browser (user agent) that calls the site's routes and external resources.",
		topology: {
			persistedAs: HTTP_CLIENT_LABEL,
			accessLevel: Access.private,
			instrumentation: true,
			observesActuality: true,
			type: AS_APPLICATION,
			id: "id",
			properties: { id: LinkRelations.IDENTIFIER.rel, name: LinkRelations.NAME.rel },
			displayLabel: "name",
		},
	},
	{
		selectors: [HTTP_HOST_LABEL],
		schema: httpHostSchema,
		description: "A host seen on the network, with how many requests reached it (the http-trace hosts aggregate).",
		topology: {
			persistedAs: HTTP_HOST_LABEL,
			accessLevel: Access.private,
			instrumentation: true,
			observesActuality: true,
			type: AS_SERVICE,
			id: "id",
			properties: { id: LinkRelations.IDENTIFIER.rel, name: LinkRelations.NAME.rel, requestCount: LinkRelations.TAG.rel },
			displayLabel: "name",
		},
	},
	{
		selectors: [VISITED_PAGE_LABEL],
		schema: visitedPageSchema,
		description: "A page the browser navigated to during actuality, identified by its page, its navigation on that page and its time; its name is the page URL.",
		topology: {
			persistedAs: VISITED_PAGE_LABEL,
			accessLevel: Access.private,
			instrumentation: true,
			observesActuality: true,
			type: SCHEMA_WEB_PAGE,
			subClassOf: [FOAF_DOCUMENT, PROV_ENTITY],
			id: "id",
			keys: [{ address: ["page", "navigation", "generatedAtTime"] }],
			properties: { id: LinkRelations.IDENTIFIER.rel, page: LinkRelations.TAG.rel, navigation: LinkRelations.TAG.rel, name: LinkRelations.NAME.rel },
			displayLabel: "name",
		},
	},
	{ selectors: [DOMAIN_PAGE_LOCATOR], schema: locatorSchema, properties: locatorRowProperties(DOMAIN_PAGE_LOCATOR), description: "Playwright selector such as css= or text=" },
	{
		selectors: [DOMAIN_PAGE_TEXT],
		schema: locatorSchema,
		properties: locatorRowProperties(DOMAIN_PAGE_TEXT),
		description: "Text a page shows, located by getByText with an exact match",
	},
	{
		selectors: [...PAGE_LOCATOR_DOMAINS],
		schema: locatorSchema,
		properties: locatorProperties((subject) => modeOf(unionLocatorRow(subject))),
		description:
			"An element on a page, identified by a value of any locator domain; a bare word names a test id, a selector locates by css, and other text names what the page shows",
	},
	{ selectors: [DOMAIN_KEYBOARD_KEY], schema: NameSchema, description: "A key as Playwright names it, such as Enter or Control+A" },
	{ selectors: [DOMAIN_MEDIA_TYPE], schema: MediaTypeSchema, description: "A media type, such as application/json" },
	{
		selectors: [DOMAIN_PAGE_TEST_ID],
		schema: locatorSchema,
		properties: locatorRowProperties(DOMAIN_PAGE_TEST_ID),
		description: "Playwright getByTestId selector (data-testid attribute)",
	},
	{ selectors: [DOMAIN_PAGE_LABEL], schema: locatorSchema, properties: locatorRowProperties(DOMAIN_PAGE_LABEL), description: "Playwright getByLabel selector (label text)" },
	{
		selectors: [DOMAIN_PAGE_PLACEHOLDER],
		schema: locatorSchema,
		properties: locatorRowProperties(DOMAIN_PAGE_PLACEHOLDER),
		description: "Playwright getByPlaceholder selector (placeholder text)",
	},
	{ selectors: [DOMAIN_PAGE_ROLE], schema: locatorSchema, properties: locatorRowProperties(DOMAIN_PAGE_ROLE), description: "Playwright getByRole selector (ARIA role)" },
	{ selectors: [DOMAIN_PAGE_TITLE], schema: locatorSchema, properties: locatorRowProperties(DOMAIN_PAGE_TITLE), description: "Playwright getByTitle selector (title attribute)" },
	{
		selectors: [DOMAIN_PAGE_ALT_TEXT],
		schema: locatorSchema,
		properties: locatorRowProperties(DOMAIN_PAGE_ALT_TEXT),
		description: "Playwright getByAltText selector (alt attribute)",
	},
	{
		selectors: [DOMAIN_BROWSER_PAGE],
		schema: z.coerce.number().int().nonnegative(),
		description: "A page of the browser actuality drives, by the number of its tab: its address, title, cookies, and query",
		properties: browserPageProperties,
	},
	{
		selectors: [DOMAIN_HTTP_RESPONSE],
		schema: CapturedResponseSchema,
		description: "A response an HTTP step received, as the step's product: its status, headers, text and json, and the link to the artifact holding a binary body's bytes",
	},
];
