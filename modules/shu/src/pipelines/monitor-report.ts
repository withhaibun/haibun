/**
 * The monitor's report: the addresses its page and its report open at, in the form every hash of the page takes, and the
 * standalone report of actuality.
 */
import type { AStepper } from "@haibun/core/lib/astepper.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { errorDetail } from "@haibun/core/lib/util/index.js";
import { obscuredText } from "@haibun/core/lib/steps/derivations/obscured.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { SEQ_PATH_FIELD, executionOf } from "@haibun/core/lib/seq-path.js";
import { discoverSteps } from "@haibun/core/lib/steps/derivations/discover-steps.js";
import { runRegistry } from "@haibun/core/lib/step-registry.js";
import { EVERY_DEFINITION } from "@haibun/core/lib/step-discovery.js";
import { shownTo } from "@haibun/core/lib/capability-context.js";
import { SHU_TAG } from "../domains/elements.js";
import type { THydration } from "../domains/hydration.js";
import { hashOf, hashWithColumns } from "../page/derivations/address.js";
import { carriedActuality } from "../page/client-cache/pipelines/carried-actuality.js";
import { buildReportHtml, inlineScriptsForView } from "../derivations/page-html.js";
import { NOT_CLUSTERED, clusters, graphSource } from "./graph-source.js";
import { carriedLabelFont } from "../derivations/carried-label-font.js";
import { BUNDLE_NAMES, bundleFileName } from "../domains/bundle-files.js";
import type { TBundleFile } from "../ports.js";

/** The hash parameter that names the type a graph query reads. */
const LABEL_PARAM = "label";

/** What the monitor's page shows a reader who arrives without an address: the monitor, beside the executions this device
 *  holds, where the reader opens an earlier feature. */
export const MONITOR_OPENS_AT = hashWithColumns([SHU_TAG.MONITOR_COLUMN, SHU_TAG.CLIENT_CACHE_COLUMN]);

/** Returns the hash the report opens at: the query of the type a graph query read, or undefined where actuality didn't run
 *  a graph query. */
export const reportOpensAt = (queriedLabel: string | undefined): string | undefined =>
	queriedLabel === undefined ? undefined : hashOf(new URLSearchParams({ [LABEL_PARAM]: queriedLabel }));

/** A step's action as the report runs it: without arguments, returning the products it read. */
type TReadStep = () => Promise<unknown> | unknown;

/** What a report is built from: actuality's world, the monitor's view steps by name, the type a graph query read last,
 *  the built bundles, which hold the report bundle and the label font, and whether the payload is compressed. */
export type TReportScope = { world: TWorld; viewSteps: [string, TReadStep][]; queriedLabel: string | undefined; bundles: TBundleFile; compressed: boolean };

/** The steps whose products the report refreshes at its end, under the name through which the affordances panel reads them. */
const REFRESHED_AT_THE_END = ["affordancesOnOffer"];

/** Runs `read` and returns its products, or undefined where it fails or doesn't return products. A failure is a warning:
 *  the report carries what the other views showed. */
async function productsOf(world: TWorld, name: string, read: TReadStep): Promise<Record<string, unknown> | undefined> {
	try {
		const result = (await read()) as { products?: Record<string, unknown> } | undefined;
		return result?.products;
	} catch (err) {
		world.eventLogger.warn(`[shu report] ${name} failed: ${errorDetail(err)}`);
		return undefined;
	}
}

/**
 * What the views showed that actuality doesn't record: the view each of the monitor's toggles opened, and the affordances
 * as they stand at the end. An earlier read cached the affordances of an empty graph, and the offline panel reads this one.
 */
async function viewProductsOf(scope: TReportScope): Promise<Record<string, unknown>> {
	const { world } = scope;
	const viewProducts: Record<string, unknown> = {};
	const toggles = await Promise.all(scope.viewSteps.map(async ([name, read]) => [name, await productsOf(world, name, read)] as const));
	for (const [name, products] of toggles) if (products?.view) viewProducts[`MonitorStepper-${name}`] = products;
	const steppers = world.runtime.steppers as AStepper[];
	for (const stepper of steppers) {
		for (const name of REFRESHED_AT_THE_END) {
			const step = stepper.steps?.[name];
			if (step === undefined || typeof step.action !== "function") continue;
			const key = `${stepper.constructor.name}-${name}`;
			const products = await productsOf(world, key, () => (step.action as (args: Record<string, unknown>) => unknown)({}));
			if (products !== undefined) viewProducts[key] = products;
		}
	}
	return viewProducts;
}

/** The component of the view a domain names, or the name itself where the domain doesn't declare a component. */
function componentOfView(domains: TWorld["domains"], view: string): string {
	const component = (domains[view]?.ui as { component?: string } | undefined)?.component;
	return component === undefined ? view : component;
}

/**
 * The standalone report of actuality: its records and the graph in the client cache, the site's declarations as the
 * registry, what the views showed, the scripts of the views actuality showed, and the label font, with every secret
 * obscured. The report opens at the type a graph query read last. The font rides in the hydration rather than in the report
 * bundle, so a report opened from a file draws its labels offline while the bundle keeps its budget.
 */
export async function reportHtml(scope: TReportScope): Promise<string> {
	const { world } = scope;
	if (!world.runtime.steppers) throw new Error("a report reads actuality's steppers, and actuality doesn't hold them");
	const viewProducts = await viewProductsOf(scope);
	// Actuality's declarations ride in the cache as the registry, read as every caller reads them: the steps the report's
	// writer holds, which for actuality's own report is every step.
	const registry = discoverSteps(world, runRegistry(world), EVERY_DEFINITION, shownTo());
	const graph = clusters(world) ? await graphSource(world) : undefined;
	if (graph === undefined) world.eventLogger.warn(`[shu report] ${NOT_CLUSTERED}, so a page that reads this report doesn't show a graph`);
	// Which views were open, the page reads from the records it carries. The report inlines the code those views need.
	const shown = await world.shared.getStore().query({ predicate: SEQ_PATH_FIELD.showed, namedGraph: SEQ_PATH_LABEL });
	const components = new Set(shown.map((quad) => componentOfView(world.domains, String(quad.object))));
	const hydration = JSON.stringify({
		viewProducts,
		viewHash: reportOpensAt(scope.queriedLabel),
		actualityId: world.runtime.actualityId,
		cache: carriedActuality(executionOf(world.tag), registry, graph === undefined ? [] : graph.quads),
		labelFont: carriedLabelFont(scope.bundles.labelFont(), scope.bundles.labelFontRanges()),
	} satisfies THydration);
	const bundle = scope.bundles.whole(bundleFileName(BUNDLE_NAMES.report));
	const payload = JSON.stringify({ bundle, hydration, scripts: inlineScriptsForView(world.domains, components) });
	return buildReportHtml(".", obscuredText(payload, world.shared.secretTexts()), scope.compressed);
}
