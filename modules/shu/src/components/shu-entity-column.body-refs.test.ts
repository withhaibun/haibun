// @vitest-environment jsdom
/**
 * A record's body is shown in a sandboxed iframe, where a reference doesn't work, so the references the body makes are
 * listed beside it, once each: a markdown body's `#Type:id` links and an HTML body's.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { REF_DENOTES } from "@haibun/core/lib/typed-links.js";
import { MEDIA_TYPE } from "@haibun/core/lib/media-types.js";
import { ShuEntityColumn } from "./shu-entity-column.js";
import { setSiteMetadata, type SiteMetadata } from "../rels-cache.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { provideLayout } from "../test/jsdom-layout.js";

const [NOTE, SURVEY] = ["Note", "SiteSurvey"];
const META: SiteMetadata = {
	types: [NOTE, SURVEY],
	idFields: { [NOTE]: "id", [SURVEY]: "id" },
	rels: { [NOTE]: { id: "identifier" }, [SURVEY]: { id: "identifier" } },
	edgeRanges: {},
	properties: { [NOTE]: ["id"], [SURVEY]: ["id"] },
	queryable: {},
	validTimeFields: {},
	summary: {},
	ui: {},
	propertyDefinitions: {},
};

/** The references listed beside a body of this text and media type. */
async function refsBeside(content: string, mediaType: string) {
	const column = document.body.appendChild(new ShuEntityColumn());
	column.openProducts({ _type: NOTE, _summary: "n-1", id: "n-1", hasBody: [{ id: "b-1", content, mediaType }] });
	await column.updateComplete;
	return [...(column.shadowRoot?.querySelectorAll(`[data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.BODY_REFS}"] shu-ref`) ?? [])].map((ref) => [
		ref.getAttribute("kind"),
		JSON.parse(ref.getAttribute("linkTarget") ?? "{}"),
	]);
}

describe("the references a record's body makes", () => {
	beforeEach(() => {
		provideLayout();
		setSiteMetadata(META);
		document.body.innerHTML = "";
	});

	it("are listed beside the body, once each, from markdown and from HTML", async () => {
		const survey = [REF_DENOTES.individual, { persistedAs: SURVEY, id: "s-1" }];
		expect(await refsBeside(`See [the survey](#${SURVEY}:s-1), [again](#${SURVEY}:s-1) and [surveys](#${SURVEY}).`, MEDIA_TYPE.markdown)).toEqual([
			survey,
			[REF_DENOTES.type, { domain: SURVEY }],
		]);
		expect(await refsBeside(`<p>See <a href="#${SURVEY}:s-1">the survey</a> and <a href="#intro">below</a>.</p>`, MEDIA_TYPE.html)).toEqual([survey]);
	});

	it("are empty where the body doesn't make a reference", async () => {
		expect(await refsBeside("Plain words.", MEDIA_TYPE.markdown)).toEqual([]);
	});
});
