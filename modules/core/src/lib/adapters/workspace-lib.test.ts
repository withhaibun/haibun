import { describe, it, expect } from "vitest";
import * as TFileSystemJs from "./workspace-lib.js";

import nodeFS, { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { RemoteStepperProxy } from "../transport/remote-proxy-stepper.js";
import { itemAt } from "../domains/item-at.js";

describe("workspace", () => {
	it("finds workspace root", () => {
		const pkgPath = join(TFileSystemJs.workspaceRoot, "package.json");
		expect(existsSync(pkgPath)).toBe(true);
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
		expect(pkg.name).toBe("haibun");
	});
});

describe("getSteppers", () => {
	it("loads a remote entry's stepper as a class that extends core's remote stepper proxy", async () => {
		const Remote = itemAt(await TFileSystemJs.getSteppers([{ remote: "http://localhost:1" }]), 0);
		expect(new Remote()).toBeInstanceOf(RemoteStepperProxy);
	});
});

const rel = (pat: string) => pat.replace(`${TFileSystemJs.workspaceRoot}/`, "");

describe("getModuleLocation", () => {
	it("resolves a bare core stepper name to modules/core/(build|src)/steps", () => {
		const resolved = rel(TFileSystemJs.getModuleLocation("test"));
		expect(resolved === "modules/core/build/steps/test" || resolved === "modules/core/src/steps/test").toBe(true);
	});
	it("finds module location for relative path", () => {
		expect(rel(TFileSystemJs.getModuleLocation("./src/test.js"))).toBe("src/test.js");
	});
	it("finds module location for @scoped package", () => {
		expect(rel(TFileSystemJs.getModuleLocation("@haibun/logic"))).toBe("node_modules/@haibun/logic");
	});
});

describe("packageLocation", () => {
	/** A directory holding a package that names itself, beside the node_modules that holds another package. */
	const workspace = () => {
		const root = mkdtempSync(join(tmpdir(), "package-location-"));
		const write = (file: string, content: unknown) => {
			mkdirSync(dirname(join(root, file)), { recursive: true });
			writeFileSync(join(root, file), JSON.stringify(content));
		};
		write("package.json", { name: "@scope/app", exports: { "./config.base.json": "./config.base.json", "./service/*": "./service/*", "./*": "./build/*" } });
		write("group/package.json", { name: "@scope/app-group" });
		write("node_modules/@scope/lib/package.json", { name: "@scope/lib", exports: { "./waypoints": "./waypoints", "./*": { "haibun-source": "./src/*", default: "./build/*" } } });
		return root;
	};

	it("finds a package that names itself, at or above the directory, and maps the subpath through its exports", () => {
		const root = workspace();
		expect(TFileSystemJs.packageLocation("@scope/app/config.base.json", join(root, "group"), nodeFS)).toBe(join(root, "config.base.json"));
		expect(TFileSystemJs.packageLocation("@scope/app/graph/graph-stepper", join(root, "group"), nodeFS)).toBe(join(root, "build/graph/graph-stepper"));
	});

	it("takes the export pattern with the longest prefix, as Node does", () => {
		expect(TFileSystemJs.packageLocation("@scope/app/service/config.json", workspace(), nodeFS), "./service/* is longer than ./*").toMatch(/\/service\/config\.json$/);
	});

	it("finds an installed package in node_modules, at its default branch", () => {
		const root = workspace();
		expect(TFileSystemJs.packageLocation("@scope/lib/waypoints", join(root, "group"), nodeFS)).toBe(join(root, "node_modules/@scope/lib/waypoints"));
		expect(TFileSystemJs.packageLocation("@scope/lib/stepper", root, nodeFS)).toBe(join(root, "node_modules/@scope/lib/build/stepper"));
	});

	it("exports every path of a package without an exports map", () => {
		const root = workspace();
		expect(TFileSystemJs.packageLocation("@scope/app-group/config.shared.json", join(root, "group", "instance"), nodeFS)).toBe(join(root, "group/config.shared.json"));
	});

	it("refuses a package that isn't installed, and names where it looked", () => {
		const root = workspace();
		expect(() => TFileSystemJs.packageLocation("@scope/absent/x", root, nodeFS)).toThrow(`the package @scope/absent isn't installed at or above ${root}`);
	});
});

describe("getSteppers", () => {
	it("loads a stepper once, however many entries name it", async () => {
		expect(await TFileSystemJs.getSteppers(["variables-stepper", "variables-stepper"])).toHaveLength(1);
	});
});
