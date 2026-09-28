import { it, expect, describe } from "vitest";

import { DEFAULT_DEST } from "@haibun/core/schema/protocol.js";
import { BaseOptions } from "./BaseOptions.js";

const defaultEnv = { DEST: DEFAULT_DEST };

describe("apply ENV", () => {
	it("creates env", () => {
		const res = BaseOptions.options.ENV.parse("a=1", defaultEnv);
		expect(res.error).not.toBeDefined();
		expect(res.env).toEqual({ ...defaultEnv, a: "1" });
	});
	it("prevents collision", () => {
		const p = { a: "1" };
		const res = BaseOptions.options.ENV.parse("a=1", p);
		expect(res.parseError).toBe("ENV a already defined");
	});
	it("refuses a variable without a value", () => {
		expect(BaseOptions.options.ENV.parse("a", {}).parseError).toBe("ENV a doesn't have a value: write a=value");
	});
});
