/**
 * Node-only module loader. Resolves package paths and imports stepper classes.
 * Kept under util/node/ because it pulls `fs` and `path`; not for browser bundles.
 */
import nodeFS from "fs";
import path from "path";

type TClass = { new <T>(...args: unknown[]): T };

/**
 * Resolve and import a stepper module.
 * Supports:
 * - Package names: @haibun/monitor-tui → resolves main from package.json
 * - Explicit paths: @haibun/monitor-tui/build/index → imports directly
 * - Relative paths: ./build-local/test-server → imports from cwd
 */
export async function use(module: string): Promise<TClass> {
	try {
		const resolvedPath = resolveModulePath(module);
		const re: object = (await import(resolvedPath)).default;
		checkModuleIsClass(re, module);
		return <TClass>re;
	} catch (e) {
		console.error("failed including", module);
		throw e;
	}
}

function resolveModulePath(module: string): string {
	// Check if this is a directory with package.json (package reference)
	if (nodeFS.existsSync(module)) {
		const pkgPath = path.join(module, "package.json");
		if (nodeFS.existsSync(pkgPath)) {
			const pkg = JSON.parse(nodeFS.readFileSync(pkgPath, "utf-8"));
			const main = pkg.main || "index.js";
			return path.join(module, main);
		}
		if (nodeFS.existsSync(`${module}.js`)) {
			return `${module}.js`;
		}
		const indexPath = path.join(module, "index.js");
		if (nodeFS.existsSync(indexPath)) {
			return indexPath;
		}
	}
	return `${module}.js`;
}

export function checkModuleIsClass(re: object, module: string): void {
	const type = re?.toString().replace(/^ /g, "").split("\n")[0].replace(/\s.*/, "");
	if (type !== "class") {
		throw Error(`"${module}" is ${type}, not a class`);
	}
}
