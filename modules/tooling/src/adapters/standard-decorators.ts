import { transform } from "esbuild";
import type { Plugin } from "vite";

/** shu's elements use standard decorators (`@property accessor`), which Vite's own transformer passes through for Node to
 *  reject, so esbuild lowers them before it sees the file. */
const SHU_SOURCE = /\/modules\/shu\/src\/.*\.ts$/;
export const standardDecorators: Plugin = {
	name: "standard-decorators",
	enforce: "pre",
	async transform(code, id) {
		if (!SHU_SOURCE.test(id)) return undefined;
		const { code: lowered, map } = await transform(code, {
			loader: "ts",
			target: "es2022",
			sourcemap: true,
			sourcefile: id,
			tsconfigRaw: { compilerOptions: { experimentalDecorators: false } },
		});
		return { code: lowered, map };
	},
};
