import { z } from "zod";
import { ENDPOINT_LABEL, HTTP_CLIENT_LABEL, HTTP_HOST_LABEL, HTTP_REQUEST_LABEL, LinkRelations, PersistedVertexSchema, TDomainDefinition } from "@haibun/core/lib/resources.js";
import { DOMAIN_STRING } from "@haibun/core/lib/domains.js";
import { ENDPOINT_CLASS } from "@haibun/core/lib/http-observations.js";
import { DOMAIN_RELAY_ATTACHMENT, RelayAttachmentSchema } from "./relay/relay-wire.js";

/** A page the browser navigated to. */
export const VISITED_PAGE_LABEL = "VisitedPage";

export const DOMAIN_PAGE_LOCATOR = "page-locator";
export const DOMAIN_PAGE_TEST_ID = "page-test-id";
export const DOMAIN_PAGE_LABEL = "page-label";
export const DOMAIN_PAGE_PLACEHOLDER = "page-placeholder";
export const DOMAIN_PAGE_ROLE = "page-role";
export const DOMAIN_PAGE_TITLE = "page-title";
export const DOMAIN_PAGE_ALT_TEXT = "page-alt-text";

const locatorSchema = z.string().min(1, "locator cannot be empty");
export const PageContentsSchema = z.object({ html: z.string() });
export const AccessibilitySnapshotSchema = z.object({
	url: z.string(),
	title: z.string(),
	snapshot: z.string().describe("The page's aria snapshot, in YAML."),
	_links: z.record(z.string(), z.object({ method: z.string() }).strict()),
});
export const RestJsonCountSchema = z.object({ summary: z.string(), details: z.object({ count: z.number() }) });
/** The domains of what reading a page and a JSON response answer with. */
export const DOMAIN_PAGE_CONTENTS = "page-contents";
export const DOMAIN_ACCESSIBILITY_SNAPSHOT = "accessibility-snapshot";
export const DOMAIN_JSON_RESPONSE_COUNT = "json-response-count";
/** The domain of an extension loaded into the browser the run launches: its id and the origin its pages are at. */
export const DOMAIN_BROWSER_EXTENSION = "browser-extension";
const BrowserExtensionSchema = z.object({ id: z.string(), origin: z.string() });

const HTTP_NS = { http: "http://www.w3.org/2011/http#" };
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
const visitedPageSchema = PersistedVertexSchema.extend({ id: z.string(), name: z.string().optional(), generatedAtTime: z.string() });

export const WebPlaywrightDomains: TDomainDefinition[] = [
	{ selectors: [DOMAIN_PAGE_CONTENTS], schema: PageContentsSchema, description: "A page's markup, as the browser holds it" },
	{ selectors: [DOMAIN_ACCESSIBILITY_SNAPSHOT], schema: AccessibilitySnapshotSchema, description: "A page as its accessibility tree reads, with the steps that act on it" },
	{ selectors: [DOMAIN_JSON_RESPONSE_COUNT], schema: RestJsonCountSchema, description: "How many entries the last JSON response held" },
	{ selectors: [DOMAIN_BROWSER_EXTENSION], schema: BrowserExtensionSchema, description: "An extension loaded into the browser the run launches, and the origin its pages are at" },
	{ selectors: [DOMAIN_RELAY_ATTACHMENT], schema: RelayAttachmentSchema, description: "What the browser relay holds: a person's attached browser, its holder and its tabs" },
	{
		selectors: [HTTP_REQUEST_LABEL],
		schema: httpRequestSchema,
		description: "An HTTP request observed on the network: one record of a client, the site, or an external host exchanging a message.",
		topology: {
			persistedAs: HTTP_REQUEST_LABEL,
			instrumentation: true,
			type: "http:Request",
			id: "id",
			namespaces: HTTP_NS,
			properties: {
				id: LinkRelations.IDENTIFIER.rel,
				method: LinkRelations.TAG.rel,
				status: LinkRelations.TAG.rel,
				durationMs: LinkRelations.TAG.rel,
				url: LinkRelations.TAG.rel,
				endpointClass: LinkRelations.TAG.rel,
				generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel,
			},
			// The browser performs a request, or the site does where it requests something itself; a request targets the
			// endpoint of this site it reached, or the external host it was sent to.
			edges: {
				performedBy: { rel: LinkRelations.PERFORMED_BY.rel, range: [HTTP_CLIENT_LABEL, HTTP_HOST_LABEL] },
				target: { rel: LinkRelations.AS_TARGET.rel, range: [ENDPOINT_LABEL, HTTP_HOST_LABEL] },
			},
			// No displayLabel: the id ("GET /path") is the title; status and duration are fields, not a stored summary copy.
		},
	},
	{
		selectors: [HTTP_CLIENT_LABEL],
		schema: httpClientSchema,
		description: "The requesting party: the browser (user agent) that calls the site's routes and external resources.",
		topology: {
			persistedAs: HTTP_CLIENT_LABEL,
			instrumentation: true,
			type: "as:Application",
			id: "id",
			properties: { id: LinkRelations.IDENTIFIER.rel, name: LinkRelations.NAME.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel },
			displayLabel: "name",
		},
	},
	{
		selectors: [HTTP_HOST_LABEL],
		schema: httpHostSchema,
		description: "A host seen on the network, with how many requests reached it (the http-trace hosts aggregate).",
		topology: {
			persistedAs: HTTP_HOST_LABEL,
			instrumentation: true,
			type: "as:Service",
			id: "id",
			properties: { id: LinkRelations.IDENTIFIER.rel, name: LinkRelations.NAME.rel, requestCount: LinkRelations.TAG.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel },
			displayLabel: "name",
		},
	},
	{
		selectors: [VISITED_PAGE_LABEL],
		schema: visitedPageSchema,
		description: "A page the browser navigated to during the run, keyed by a per-navigation synthetic id; its name is the page URL.",
		topology: {
			persistedAs: VISITED_PAGE_LABEL,
			instrumentation: true,
			type: "schema:WebPage",
			id: "id",
			properties: { id: LinkRelations.IDENTIFIER.rel, name: LinkRelations.NAME.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel },
			displayLabel: "name",
		},
	},
	{
		selectors: [DOMAIN_PAGE_LOCATOR],
		schema: locatorSchema,
		description: "Playwright selector such as css= or text=",
	},
	{
		selectors: [DOMAIN_PAGE_LOCATOR, DOMAIN_STRING],
		schema: locatorSchema,
		description: "Locator that also satisfies string semantics.",
	},
	{
		selectors: [DOMAIN_PAGE_TEST_ID],
		schema: locatorSchema,
		description: "Playwright getByTestId selector (data-testid attribute)",
	},
	{
		selectors: [DOMAIN_PAGE_LABEL],
		schema: locatorSchema,
		description: "Playwright getByLabel selector (label text)",
	},
	{
		selectors: [DOMAIN_PAGE_PLACEHOLDER],
		schema: locatorSchema,
		description: "Playwright getByPlaceholder selector (placeholder text)",
	},
	{
		selectors: [DOMAIN_PAGE_ROLE],
		schema: locatorSchema,
		description: "Playwright getByRole selector (ARIA role)",
	},
	{
		selectors: [DOMAIN_PAGE_TITLE],
		schema: locatorSchema,
		description: "Playwright getByTitle selector (title attribute)",
	},
	{
		selectors: [DOMAIN_PAGE_ALT_TEXT],
		schema: locatorSchema,
		description: "Playwright getByAltText selector (alt attribute)",
	},
];
