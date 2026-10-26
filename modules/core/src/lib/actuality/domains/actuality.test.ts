/** The JSON schema a config's `$schema` names is the schema of SpeclSchema, which the package holds beside its build. */
import { describe, expect, it } from "vitest";
import { SpeclSchema } from "./actuality.js";

describe("the config's JSON schema", () => {
	it("is SpeclSchema's, so an editor checks a config as a run reads it", async () => {
		const schema = `${JSON.stringify(SpeclSchema.toJSONSchema({ target: "draft-2020-12" }), null, 2)}`;
		await expect(schema).toMatchFileSnapshot("../../../../haibun-core-specl.schema.json");
	});
});
