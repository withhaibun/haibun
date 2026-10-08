import { it, expect, describe } from "vitest";

import { DEFAULT_DEST } from "@haibun/core/schema/protocol.js";
import { BaseOptions } from "./BaseOptions.js";

const defaultEnv = { DEST: DEFAULT_DEST };

describe("apply ENV", () => {
	it("creates env", () => {
		const res = BaseOptions.options.ENV.parse("a=1", defaultEnv);
		expect(res.parseError).not.toBeDefined();
		expect(res.env).toEqual({ ...defaultEnv, a: "1" });
	});
	it("refuses a variable that is already defined", () => {
		const p = { a: "1" };
		const res = BaseOptions.options.ENV.parse("a=1", p);
		expect(res.parseError).toBe("ENV a is already defined: define each variable once");
	});
	it("refuses a variable without a value", () => {
		expect(BaseOptions.options.ENV.parse("a", {}).parseError).toBe("ENV a doesn't have a value: write a=value");
	});
});
