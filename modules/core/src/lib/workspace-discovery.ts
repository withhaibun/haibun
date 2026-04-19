import nodeFS from "fs";
import path from "path";
import { TFileSystem } from "./util/node/workspace-lib.js";

export interface HaibunWorkspace {
	/** Base path - parent of features/ folder */
	base: string;
	/** Path to config.json if it exists */
	configPath: string | null;
	/** Path to backgrounds/ folder if it exists */
	backgroundsPath: string | null;
}

/**
 * Find the haibun workspace root from a feature file path.
 * Walks up from the file until finding a 'features/' parent directory.
 * Returns the base path (parent of features/), config path, and backgrounds path.
 *
 * @param featurePath - Absolute path to a .feature file
 * @param fs - File system interface (for testing)
 * @returns Workspace info or null if no features/ parent found
 */
export function findHaibunWorkspace(featurePath: string, fs: TFileSystem = nodeFS): HaibunWorkspace | null {
	// Normalize path
	const normalized = path.normalize(featurePath);
	const parts = normalized.split(path.sep);

	// Find the 'features' or 'backgrounds' segment in the path
	let featuresIndex = -1;
	for (let i = parts.length - 1; i >= 0; i--) {
		if (parts[i] === "features" || parts[i] === "backgrounds") {
			featuresIndex = i;
			break;
		}
	}

	if (featuresIndex < 0) {
		return null;
	}

	// Base is the parent of features/
	const baseParts = parts.slice(0, featuresIndex);
	const base = baseParts.join(path.sep) || path.sep;

	// Check for config.json at base level
	const configPath = path.join(base, "config.json");
	const hasConfig = fs.existsSync(configPath);

	// Check for backgrounds/ at base level
	const backgroundsPath = path.join(base, "backgrounds");
	const hasBackgrounds = fs.existsSync(backgroundsPath);

	return {
		base,
		configPath: hasConfig ? configPath : null,
		backgroundsPath: hasBackgrounds ? backgroundsPath : null,
	};
}

/**
 * Recursively find all .feature files in a directory
 */
export async function findFeatureFiles(dir: string, fs: TFileSystem = nodeFS): Promise<string[]> {
	const results: string[] = [];
	if (!fs.existsSync(dir)) return results;

	async function recurse(currentDir: string) {
		const entries = fs.readdirSync(currentDir);
		for (const entry of entries) {
			const fullPath = path.join(currentDir, entry);
			const stat = fs.statSync(fullPath);
			if (stat.isDirectory()) {
				await recurse(fullPath);
			} else if (entry.endsWith(".feature")) {
				results.push(fullPath);
			}
		}
	}

	await recurse(dir);
	return results;
}

/**
 * Count features in the workspace (base/features)
 */
export async function countFeatures(base: string, fs: TFileSystem = nodeFS): Promise<number> {
	const featuresPath = path.join(base, "features");
	const files = await findFeatureFiles(featuresPath, fs);
	return files.length;
}

/**
 * Load all background files from a backgrounds directory
 */
export async function loadBackgroundsFromPath(
	backgroundsPath: string,
	fs: TFileSystem = nodeFS,
): Promise<Array<{ path: string; content: string; name: string; base: string }>> {
	const backgrounds: Array<{ path: string; content: string; name: string; base: string }> = [];

	if (!fs.existsSync(backgroundsPath)) {
		return backgrounds;
	}

	const base = path.dirname(backgroundsPath);
	const files = await findFeatureFiles(backgroundsPath, fs);

	for (const fullPath of files) {
		const content = fs.readFileSync(fullPath, "utf-8");
		const relativePath = fullPath.replace(base, "");
		const name = path.basename(fullPath, ".feature");
		backgrounds.push({
			path: relativePath,
			content,
			name,
			base,
		});
	}

	return backgrounds;
}
