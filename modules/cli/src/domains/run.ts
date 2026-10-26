/**
 * The declarations of the runs and instances a supervisor starts: the environment a child starts with, the capabilities a
 * caller holds to supervise, the products of starting and reading a run, the kept output of a run, and the run domains.
 */
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { z } from "zod";
import { BASE_PREFIX, MODULE_OPTION_PREFIX, NDJSON, ONCE, STAY, STAY_ALWAYS } from "@haibun/core/lib/domains/protocol.js";
import { LEVEL_STATUS } from "@haibun/core/lib/actuality/domains/level-status.js";
import { StepFailureSchema } from "@haibun/core/lib/actuality/domains/step-failure.js";
import { HAIBUN_HOST_ID_ENV } from "@haibun/core/lib/domains/host-id.js";
import { NameSchema } from "@haibun/core/lib/domains/domains.js";
import type { TDomainDefinition } from "@haibun/core/lib/domains/resources.js";

/** Environment names of the per-process options that core owns: whether a process stays up, and whether it skips a group
 *  that passed. NDJSON_ENV selects NDJSON events on a child's output. `HAIBUN_HOST_ID_ENV` holds a process's host id.
 *  Each other per-process option declares itself (see `perProcessOptionNames`). */
const STAY_ENV = `${BASE_PREFIX}${STAY}`;
const ONCE_ENV = `${BASE_PREFIX}${ONCE}`;
const NDJSON_ENV = `${BASE_PREFIX}${NDJSON}`;
/** The environment name of a process's key, which names its actuality and so its records. */
export const KEY_ENV = `${BASE_PREFIX}KEY`;

/**
 * The environment variable that holds an instance's serving port. It is the web server's own option.
 * This file names it because a launcher assigns a port to an instance whose steppers the launcher doesn't hold.
 * The launcher returns that port to its caller as the instance's serving port, so the assignment can't depend on the
 * steppers the launcher registers.
 */
export const INSTANCE_PORT_ENV = `${MODULE_OPTION_PREFIX}WEBSERVERSTEPPER_PORT`;

/** The number of characters of a run's output that RunTail keeps. RunTail drops older output. A read from a cursor
 *  before the kept output returns the dropped count, so a gap doesn't read as complete output. */
export const RUN_TAIL_CHARS = 200_000;

/**
 * The capabilities a caller must hold to supervise a process, as ZCAP-LD `allowedAction` values.
 *
 * Each value names one action. The step that performs the action declares it.
 * A step that calls another step declares the action of the step it calls, so a caller can't perform an action through
 * another step when it can't perform that action directly.
 * Grants are per action. "May start runs" and "may stop runs" are separate grants, and either can be revoked while the other remains.
 *
 * `proveStep` performs the check in the same way for a feature line, an RPC call, an MCP tool call and a model's tool call.
 * The caller's capability comes from the authority the step executes under, so the steps here don't read one.
 */
export const SUPERVISOR_CAPABILITIES = {
	/** Start a serving instance from a directory of features. */
	launch: "Instance:launch",
	/** Start a run of features. A run executes its features' steps on this machine. */
	run: "Instance:run",
	/** Read a run's output verbatim, wait for a run, and list the instances and runs this process started. */
	read: "Instance:read",
	/** End a run or an instance this process started. */
	stop: "Instance:stop",
} as const;

/** The products that starting a run and reading a run return. Both schemas are exported so a caller parses the products rather than asserting a shape. */
export const runStartedSchema = z.object({ run: z.string(), where: z.string(), filter: z.string(), record: z.string() });
export const runReadSchema = z.object({
	run: z.string(),
	status: z.string(),
	exitCode: z.number().nullable(),
	cursor: z.number(),
	output: z.string(),
	dropped: z.number(),
	// The counts a run has reported so far. They accrue from every chunk of its output, not from the kept tail, so they
	// stay complete when the output exceeds the tail.
	features: z.number(),
	steps: z.number(),
	/** The status of a run's actuality, as the actuality machine that read its events holds it. A standing run's
	 *  actuality ends and its process keeps serving without exiting, so a caller waits on this status rather than on an exit. */
	actuality: z.enum(LEVEL_STATUS),
	/** The steps that failed as the actuality's own failures, each as its id, its text and its failure message. */
	failures: z.array(StepFailureSchema),
	/** Where a run wrote its report, where it wrote one. */
	report: z.string().optional(),
});

/**
 * The kept output of a run or an instance. It holds a bounded tail that a reader reads from a cursor, and it counts the characters it drops.
 * A read from a cursor before the kept output returns the number of requested characters that were dropped.
 */
export class RunTail {
	/** The kept chunks, in arrival order. `since` joins them on a read, so `append` doesn't copy the whole tail for each
	 *  line a run prints. */
	private chunks: string[] = [];
	private keptChars = 0;
	private droppedChars = 0;
	constructor(private readonly keep: number) {}

	append(text: string): void {
		if (text === "") return;
		// Only a chunk longer than the tail is sliced to its end. The loop below drops older chunks whole.
		if (text.length > this.keep) {
			this.droppedChars += text.length - this.keep;
			text = text.slice(-this.keep);
		}
		this.chunks.push(text);
		this.keptChars += text.length;
		while (this.keptChars > this.keep) {
			// The kept characters are those of the chunks, so a chunk is held while they exceed the tail.
			const dropped = itemAt(this.chunks, 0);
			this.chunks.shift();
			this.keptChars -= dropped.length;
			this.droppedChars += dropped.length;
		}
	}

	/** Returns the output logged after `cursor`, the cursor to read from next, and the number of requested characters that were dropped. */
	since(cursor: number): { output: string; cursor: number; dropped: number } {
		const from = Math.max(0, cursor - this.droppedChars);
		return { output: this.chunks.join("").slice(from), cursor: this.droppedChars + this.keptChars, dropped: Math.max(0, this.droppedChars - cursor) };
	}
}

/**
 * Returns the environment of a child process. `port` sets the port the child's web server listens on, so two children
 * can execute at once. `standing` sets whether the child stays up after its features finish.
 * The two are independent: a run can take another port and still end when its features finish.
 * This function sets both rather than letting the child inherit them. An inherited port would put the child on the
 * supervisor's own port, and an inherited STAY would keep the child up indefinitely when the supervisor stays up.
 */
export function runEnvironment(inherited: NodeJS.ProcessEnv, port: number, standing: boolean, hostId: number | undefined, perProcess: string[]): NodeJS.ProcessEnv {
	const env = { ...inherited };
	// A child doesn't inherit a per-process option. Each option declares that it is per-process.
	for (const name of perProcess) delete env[name];
	delete env[STAY_ENV];
	delete env[ONCE_ENV];
	delete env[HAIBUN_HOST_ID_ENV];
	// The child's web server takes the given port. Another per-process port, such as a monitor's, stays unset, since two
	// servers in one child can't share a port.
	if (port > 0) env[INSTANCE_PORT_ENV] = String(port);
	if (standing) env[STAY_ENV] = STAY_ALWAYS;
	// A child with a host id is a separate host. Its seqPaths identify the host that produced them, and this process
	// can register its steps under that id.
	if (hostId !== undefined) env[HAIBUN_HOST_ID_ENV] = String(hostId);
	// This process reads the child's output, so the child writes its events as well as its formatted log. Only the
	// events carry the failures, their seqPaths and the final outcome.
	env[NDJSON_ENV] = "true";
	return env;
}

/** The domains of a run's name, its feature filter, and the products that starting, reading and stopping a run return.
 *  The test double of this supervisor in test-runner-stepper.test.ts declares them too. */
export const RUN_DOMAIN = { started: "run-started", read: "run-read", stopped: "run-stopped", name: "run-name", featureFilter: "feature-filter" } as const;
/** Whether a part of a feature filter compiles as a regular expression. haibun-cli matches each part against a feature's path. */
const isPattern = (part: string): boolean => {
	try {
		new RegExp(part);
		return true;
	} catch {
		return false;
	}
};
/** The domain of a feature filter: patterns of feature paths separated by commas, as haibun-cli takes them. An empty filter selects every feature. */
export const featureFilterDomainDefinition: TDomainDefinition = {
	selectors: [RUN_DOMAIN.featureFilter],
	schema: z
		.string()
		.refine(
			(filter) => filter.split(",").every(isPattern),
			"has a part that isn't a regular expression. A lone * isn't a regular expression, and .* matches every path. Correct that part, or leave the filter empty to run every feature",
		),
	description:
		"Comma-separated regular expressions that select the features a run executes by path. haibun-cli takes the same form. Two examples are graph and a.*b. An empty filter runs every feature",
};
export const runDomainDefinitions: TDomainDefinition[] = [
	{ selectors: [RUN_DOMAIN.name], schema: NameSchema, description: "The name of a started run. Reading, waiting for and stopping a run take this name" },
	featureFilterDomainDefinition,
	{ selectors: [RUN_DOMAIN.started], schema: runStartedSchema, description: "A run a process started: its directory, its feature filter, and the id of its actuality's record" },
	{ selectors: [RUN_DOMAIN.read], schema: runReadSchema, description: "A run's output since a cursor, its status, and the outcome accrued from its events" },
	{ selectors: [RUN_DOMAIN.stopped], schema: z.object({ run: z.string() }), description: "A run a process ended" },
];
