/**
 * A test's temporary directory, removed when the test ends. A directory a test leaves in the system's temporary directory
 * stays across runs, and thousands of them fill the disk, so every run's reads and writes slow until tests time out.
 */
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";

/** Removes a temporary directory and what it holds. */
export const removeTempDir = (dir: string): void => rmSync(dir, { recursive: true, force: true });

/** Creates a temporary directory whose name begins with `prefix`, by its real path, and removes it when the test that called
 *  this ends. A directory a file's hooks share is created with `heldTempDir` and removed in the matching after hook. */
export function testTempDir(prefix: string): string {
	const dir = heldTempDir(prefix);
	onTestFinished(() => removeTempDir(dir));
	return dir;
}

/** Creates a temporary directory whose name begins with `prefix`, by its real path, for a caller that removes it. */
export const heldTempDir = (prefix: string): string => realpathSync(mkdtempSync(join(tmpdir(), prefix)));
