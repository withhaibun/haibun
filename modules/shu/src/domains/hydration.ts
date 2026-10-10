/**
 * What a page is served with, or carries, in its hydration element: the actuality it reads, what the deployment set for it,
 * the address it opens at, and, for a page that carries a record of actuality, that record and what its views showed.
 */
import { z } from "zod";
import { ActualityIdSchema } from "@haibun/core/lib/rpc-wire.js";
import { QuadSchema } from "@haibun/core/lib/quad-types.js";

/** The build a page's code is from, by which a deployment that serves an old one is recognized. */
const PageBuildSchema = z.object({ version: z.string(), builtAt: z.string() }).strict();
export type TPageBuild = z.infer<typeof PageBuildSchema>;

/**
 * The timeout on a request a page awaits, after which the site counts as unreachable, where a deployment doesn't set one.
 * A site that accepts a request and doesn't respond leaves the view that sent it without a result or an error, so the read
 * doesn't fail and doesn't read the device's store. The timeout states that failure.
 *
 * Calibrated against measured query latency. Over a corpus of eight thousand messages the consumer's engine reads a page in
 * 10ms mean and 64ms at the 95th percentile; the consumer's benchmark bounds queries at 200ms mean and 600ms at the 95th;
 * the slowest query measured in either repository takes 727ms; and the clustered graph read at page load takes 151ms.
 * Twenty seconds is 27 times the slowest measured query, and three times the 95th percentile extrapolated linearly to a
 * corpus a hundredfold larger. A deployment on slower storage raises it.
 */
export const RESPONSE_TIMEOUT_MS = 20_000;

/** A count of milliseconds above zero. */
const MillisecondsSchema = z.number().positive();

/** What a deployment sets for the pages it serves. A reader waits out each timing, so a deployment that records fast runs
 *  sets them low, and one that follows a long-running system keeps the product's values. */
export const DeploymentSettingsSchema = z
	.object({
		/** The timeout on a request the page awaits, after which the site counts as unreachable. */
		responseTimeoutMs: MillisecondsSchema,
		/** What every reader holds here without presenting anything, as the web server declares it. */
		allowedWithoutDelegation: z.array(z.string()),
		/** Whether the deployment verifies a delegation, so the page reads what was delegated to its key: a key's proof sent
		 *  where the deployment can't check it is refused. */
		verifiesDelegations: z.boolean(),
		/** The build that produced the page's code. */
		build: PageBuildSchema,
		/** How long after the stream breaks the page opens it again, where the deployment sets it. */
		streamReconnectAfterMs: MillisecondsSchema.optional(),
		/** The origin of a page that embeds shu in a frame and posts it the page the reader has open, where the deployment
		 *  lets one embed shu. */
		embedderOrigin: z.string().optional(),
		/** The rounds of tool calls an ask starts with, before the reader chooses, where the deployment sets them. */
		askToolLimit: z.number().int().positive().optional(),
	})
	.strict();
export type TDeploymentSettings = z.infer<typeof DeploymentSettingsSchema>;

/** What a page carries of the actuality it records: the graph actuality wrote, and the site's registry as it stood. `shape`
 *  names the rule that wrote the record. */
export const CachePayloadSchema = z.object({ shape: z.string(), execution: z.string(), registry: z.unknown().optional(), quads: z.array(QuadSchema) }).strict();
export type TCachePayload = z.infer<typeof CachePayloadSchema>;

/** A page's hydration. A served page states the deployment's settings; a page that carries a record of actuality states the
 *  record and what each view showed, by the step that produces it. */
export const HydrationSchema = z
	.object({
		actualityId: ActualityIdSchema,
		/** The address the page opens at for a reader who arrives without one. */
		viewHash: z.string().optional(),
		settings: DeploymentSettingsSchema.optional(),
		cache: CachePayloadSchema.optional(),
		viewProducts: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();
export type THydration = z.infer<typeof HydrationSchema>;
