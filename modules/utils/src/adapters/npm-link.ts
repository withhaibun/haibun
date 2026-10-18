import { execSync } from "child_process";
import fs from "fs";

/** Links each dependency and development dependency that the package.json in the working directory lists, and returns npm's output for each. */
export function linkDependencies(): string[] {
	const pkg = JSON.parse(fs.readFileSync("./package.json", "utf-8"));
	const listed: (Record<string, string> | undefined)[] = [pkg.dependencies, pkg.devDependencies];
	return listed
		.flatMap((dependencies) => (dependencies === undefined ? [] : Object.keys(dependencies)))
		.map((name) => {
			console.log(`Linking ${name}`);
			return execSync(`npm link ${name}`).toString();
		});
}
