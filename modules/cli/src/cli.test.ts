import { describe, it, expect } from "vitest";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("cli executable", () => {
	it("exits with code 1 on runCli error", async () => {
		const cliPath = path.resolve(__dirname, "../build/cli.js");

		try {
			// --run-policy without arguments will throw synchronously in processArgs,
			// triggering the .catch() block in cli.ts and setting process.exitCode = 1
			await execAsync(`node ${cliPath} --run-policy`);
			expect.fail("Should have failed");
		} catch (e: unknown) {
			const error = e as { code?: number; stderr?: string; name?: string };
			expect(error.code).toBe(1);
			expect(error.stderr).toContain("cli Error");
		}
	});

	it("exits with code 1 on unhandledRejection", async () => {
		const cliPath = path.resolve(__dirname, "../build/cli.js");

		try {
			const evalScript = `
        process.argv = ['node', 'cli.js', '--help'];
        process.exit = () => {};
        import('${cliPath.replace(/\\/g, "/")}').then(() => {
          setTimeout(() => Promise.reject(new Error('test unhandledRejection')), 10);
        });
      `.replace(/\n/g, "");

			await execAsync(`node --eval "${evalScript}"`);
			// If we reach here, execAsync didn't throw, meaning exit code was 0
			expect.fail("execAsync should have thrown an error with code 1");
		} catch (e: unknown) {
			const error = e as { code?: number; stderr?: string; name?: string };
			if (error.name === "AssertionError") throw error;
			expect(error.code).toBe(1);
			expect(error.stderr).toContain("cli Unhandled Rejection:");
		}
	});
});
