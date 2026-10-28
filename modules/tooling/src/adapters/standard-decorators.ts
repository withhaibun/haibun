import { transform } from "esbuild";
import type { Plugin } from "vite";

/** shu's elements use standard decorators (`@property accessor`), in its source and in its build, which keeps them for a bundle
 *  to lower. Vite's own transformer passes them through for Node to reject, so esbuild lowers them before it sees the file. */
const SHU_ELEMENTS = /\/modules\/shu\/(?:src\/.*\.ts|build\/.*\.js)$/;
export const standardDecorators: Plugin = {
	name: "standard-decorators",
	enforce: "pre",
	async transform(code, id) {
		if (!SHU_ELEMENTS.test(id)) return undefined;
		const { code: lowered, map } = await transform(code, {
			loader: id.endsWith(".ts") ? "ts" : "js",
			target: "es2022",
			sourcemap: true,
			sourcefile: id,
			tsconfigRaw: { compilerOptions: { experimentalDecorators: false } },
		});
		return { code: lowered, map };
	},
};
