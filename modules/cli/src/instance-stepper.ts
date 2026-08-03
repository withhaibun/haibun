/**
 * InstanceStepper — supervise sibling haibun instances. `start a haibun instance from {where} on port
 * {port} as host {hostId}` forks the same cli.js an operator runs, against the config directory a real
 * deployment would use; the child serves because ITS feature ends with `this feature runs as a service
 * until stopped`. Readiness is the action.begin handshake (the same one federation and remote steppers
 * use), so the step's products carry the instance's url, site principal, and hostId. Assigning hostIds
 * stays an operator concern — the feature states the id, and the handshake verifies the child took it.
 * Children are terminated at endFeature; a launched instance never outlives the feature that owns it.
 */
import { fork, type ChildProcess } from "child_process";
import { createRequire } from "module";
import { existsSync } from "fs";
import path from "path";
import { z } from "zod";
import { AStepper, type IHasCycles, type IStepperCycles, type TEndFeature } from "@haibun/core/lib/astepper.js";
import { actionNotOK, actionOKWithProducts } from "@haibun/core/lib/util/index.js";
import { RpcClient } from "@haibun/core/lib/rpc-client.js";

const READY_DEADLINE_MS = 30_000;
const READY_POLL_MS = 300;
const STDERR_TAIL_CHARS = 4_000;

/** The run variable a launched instance reads to address its launcher: `use store at $LAUNCHED_FROM$ …`. */
export const LAUNCHED_FROM = "LAUNCHED_FROM";

const instanceStartedSchema = z.object({ url: z.string(), site: z.string(), hostId: z.number() });

/** What a launched instance was launched from, so the same instance can be launched again after it is stopped. */
type TLaunch = { dir: string; config: string; port: number; hostId: number };

export default class InstanceStepper extends AStepper implements IHasCycles {
	description = "Start and supervise sibling haibun instances (forked cli.js, readiness via action.begin, terminated at endFeature)";

	private children: Array<{ child: ChildProcess; label: string; launch: TLaunch }> = [];

	cycles: IStepperCycles = {
		endFeature: async (endFeature?: TEndFeature) => {
			if (!endFeature?.shouldClose) return;
			await Promise.all(this.children.map(({ child }) => terminate(child)));
			this.children = [];
		},
	};

	steps = {
		startInstance: {
			gwta: `start a haibun instance from {where} on port {port: number} as host {hostId: number}`,
			productsSchema: instanceStartedSchema,
			action: async ({ where, port, hostId }: { where: string; port: number; hostId: number }) => {
				const dir = path.resolve(String(where));
				const config = path.join(dir, "config.json");
				if (!existsSync(config)) return actionNotOK(`start instance: no config.json in ${dir}`);
				return await this.launch({ dir, config, port, hostId });
			},
		},
		restartInstance: {
			gwta: `restart the haibun instance on port {port: number}`,
			description:
				"Stop an instance this run launched and launch it again from what it was launched from, waiting for it to answer. What an instance serves comes from its source, so a change to that source takes effect only once it runs again. The run that restarts an instance is never the instance being restarted.",
			productsSchema: instanceStartedSchema,
			action: async ({ port }: { port: number }) => {
				const held = this.children.find((c) => c.launch.port === port);
				if (!held) return actionNotOK(`restart instance: this run launched no instance on port ${port}`);
				await terminate(held.child);
				this.children = this.children.filter((c) => c !== held);
				return await this.launch(held.launch);
			},
		},
	};

	/** Fork the CLI and wait for the action.begin handshake. One path, so a restarted instance is launched exactly as it
	 *  was first launched. */
	private async launch({ dir, config, port, hostId }: TLaunch) {
		const cliEntry = createRequire(import.meta.url).resolve("@haibun/cli");
		// The child inherits this process's environment with its OWN port, so the launcher's port is not readable from
		// it. LAUNCHED_FROM is passed as a run variable ($LAUNCHED_FROM$), which is how a launched instance addresses
		// the run that started it — mounting its store, reporting to it — without naming a port in its own source.
		const launcherPort = process.env.HAIBUN_O_WEBSERVERSTEPPER_PORT;
		const passed = [process.env.HAIBUN_ENV, launcherPort ? `${LAUNCHED_FROM}=http://localhost:${launcherPort}` : ""].filter(Boolean).join(",");
		const env = { ...process.env, HAIBUN_O_WEBSERVERSTEPPER_PORT: String(port), HAIBUN_HOST_ID: String(hostId), ...(passed ? { HAIBUN_ENV: passed } : {}) };
		// execArgv: [] — the child is plain node running the built CLI; it must not inherit a test runner's loader flags.
		const child = fork(cliEntry, ["-c", config, dir], { env, silent: true, execArgv: [] });
		let stderrTail = "";
		child.stderr?.on("data", (data: Buffer) => {
			process.stderr.write(`[instance:${hostId}] ${data.toString()}`);
			stderrTail = (stderrTail + data.toString()).slice(-STDERR_TAIL_CHARS);
		});
		this.children.push({ child, label: `${dir} host ${hostId}`, launch: { dir, config, port, hostId } });

		const url = `http://localhost:${port}`;
		const rpc = new RpcClient({ baseUrl: url, timeoutMs: 1_500, retry: { maxAttempts: 1 } });
		const deadline = Date.now() + READY_DEADLINE_MS;
		while (Date.now() < deadline) {
			if (child.exitCode !== null) return actionNotOK(`instance at ${dir} exited before ready (code ${child.exitCode})${stderrTail ? `\n${stderrTail}` : ""}`);
			const result = await rpc.call<{ hostId?: number; site?: string; serving?: boolean }>("action.begin", {}, []);
			if (typeof (result as { error?: unknown }).error !== "string") {
				const begun = result as { hostId?: number; site?: string; serving?: boolean };
				// Ready means serving: the instance's feature has run everything it sets up. Its port answers earlier, and a
				// caller that took that as ready would race whatever the feature does after listening.
				if (begun.serving !== true) {
					await new Promise((r) => setTimeout(r, READY_POLL_MS));
					continue;
				}
				// The handshake verifies the child took the assigned identity — a silently-wrong hostId would break seqPath and site uniqueness.
				if (begun.hostId !== hostId) return actionNotOK(`instance at ${url} reports hostId ${begun.hostId}, expected ${hostId}`);
				if (typeof begun.site !== "string" || begun.site.length === 0) return actionNotOK(`instance at ${url} did not report a site principal`);
				return actionOKWithProducts({ url, site: begun.site, hostId });
			}
			await new Promise((r) => setTimeout(r, READY_POLL_MS));
		}
		return actionNotOK(`instance at ${dir} not ready on ${url} within ${READY_DEADLINE_MS}ms${stderrTail ? `\n${stderrTail}` : ""}`);
	}
}

/** SIGTERM, then SIGKILL if the child hasn't exited within 5s — a launched instance never outlives its owner. */
function terminate(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null) return Promise.resolve();
	return new Promise((resolve) => {
		const killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
		child.once("exit", () => {
			clearTimeout(killTimer);
			resolve();
		});
		child.kill("SIGTERM");
	});
}
