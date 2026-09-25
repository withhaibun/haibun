/**
 * Run-facing steps and observation sources for blips. Recording is in `lib/blips.ts`.
 *
 * Two readings: the rollup counts per name for the whole run and is always attached; a watch is started by name and
 * holds a bounded window in order. Counts say how many, the window says in what order. Both are observation sources,
 * read with `observed in`.
 */
import { AStepper, type IHasCycles, type IObservationSource, type IStepperCycles, type TStepperSteps } from "../lib/astepper.js";
import { blipDeclarations, blipDeclared, blipRollup, blipWatch, WATCH_WINDOW, type TBlipSeries } from "../lib/blips.js";
import { actionNotOK, actionOKWithProducts } from "../lib/util/index.js";
import { OK } from "../schema/protocol.js";
import type { TBlipEvent } from "../schema/protocol.js";
import { z } from "zod";
import { listedSchema } from "../lib/domains.js";

const WatchSchema = z.object({ watching: z.array(z.string()), window: z.number() });
const SeriesSchema = z.object({ name: z.string(), labels: z.record(z.string(), z.string()), count: z.number(), sum: z.number().optional(), max: z.number().optional() });
const ShowSchema = z.object({ text: z.string(), held: z.number(), seen: z.number(), watching: z.array(z.string()), totals: z.array(SeriesSchema) });
const DeclaredSchema = z.object({ text: z.string(), names: z.array(z.string()) });
/** The domains of what watching and showing blips answer with. */
const DOMAIN_BLIP_WATCH = "blip-watch";
/** The blips a watch names, given as a list; a dotted namespace names everything under it. */
const DOMAIN_BLIP_NAMES = "blip-names";
const DOMAIN_WATCHED_BLIPS = "watched-blips";
const DOMAIN_DECLARED_BLIPS = "declared-blips";

/** One occurrence as a line: ordinal, name, value, step, attributes. */
export function renderOccurrence(blip: TBlipEvent, index: number): string {
	const detail = Object.entries(blip.attributes ?? {}).map(([k, v]) => `${k}=${String(v)}`);
	const parts = [`${index + 1}`, blip.name, ...(blip.value === undefined ? [] : [`value=${blip.value}`]), ...(blip.seqPath ? [`step=${blip.seqPath}`] : []), ...detail];
	return parts.join(" ");
}

/** A value as shown: to a tenth, which is finer than any reading of a total. */
const shown = (value: number) => Number(value.toFixed(1));

/** One series as a line: its name and dimension values, how many, and for measured occurrences their total and the
 *  largest, in the declared unit. */
export function renderSeries(series: TBlipSeries): string {
	const labels = Object.entries(series.labels).map(([dimension, value]) => ` ${dimension}=${value}`);
	const unit = blipDeclared(series.name)?.unit;
	const inUnit = (value: number) => `${shown(value)}${unit ? ` ${unit}` : ""}`;
	const measured = series.sum === undefined || series.max === undefined ? "" : `, ${inUnit(series.sum)} in all, largest ${inUnit(series.max)}`;
	return `${series.name}${labels.join("")}: ${series.count}${measured}`;
}

/** The watch as text: the total recorded, each series over every occurrence recorded, and the window, oldest first. */
export function renderWatch(occurrences: readonly TBlipEvent[], seen: number, totals: readonly TBlipSeries[]): string {
	if (seen === 0) return "No occurrences were recorded for the watched names.";
	const dropped = seen - occurrences.length;
	return [
		`${seen} occurrence(s) recorded. By name and dimension, over all of them:`,
		...totals.map(renderSeries),
		`In order${dropped > 0 ? `, showing the most recent ${occurrences.length}` : ""}, oldest first:`,
		...occurrences.map(renderOccurrence),
	].join("\n");
}

export default class BlipsStepper extends AStepper implements IHasCycles {
	description = "Fine-grained occurrences a run records but does not retain: per-name counts, and an ordered window over watched names";

	private sources: IObservationSource[] = [
		{
			// Counts per name. Always attached; one counter per declared name.
			name: "blips",
			observe: () => Promise.resolve(blipRollup.observe()),
		},
		{
			// Order. Each item is prefixed with its position, so repeated occurrences stay distinct items.
			// The declared attributes ride along as metrics, so a quantifier binds e.g. occurrence/view and occurrence/reason;
			// the reserved keys win a collision, since they are what every occurrence answers for.
			name: "watched blips",
			observe: () => {
				const held = blipWatch.occurrences();
				const metrics: Record<string, Record<string, unknown>> = {};
				const items = held.map((blip, i) => {
					const item = renderOccurrence(blip, i);
					metrics[item] = {
						...blip.attributes,
						index: i + 1,
						name: blip.name,
						...(blip.seqPath ? { step: blip.seqPath } : {}),
						...(blip.value === undefined ? {} : { value: blip.value }),
					};
					return item;
				});
				return Promise.resolve({ items, metrics });
			},
		},
	];

	cycles: IStepperCycles = {
		getConcerns: () => ({
			sources: this.sources,
			domains: [
				{ selectors: [DOMAIN_BLIP_WATCH], schema: WatchSchema, description: "The blips a run watches, and over what window" },
				{
					selectors: [DOMAIN_BLIP_NAMES],
					schema: listedSchema(z.string().min(1), "blip"),
					description: "The blips a watch names, given as a list or as text separated by commas; a dotted namespace names everything under it",
				},
				{ selectors: [DOMAIN_WATCHED_BLIPS], schema: ShowSchema, description: "What the watched blips held and totalled" },
				{ selectors: [DOMAIN_DECLARED_BLIPS], schema: DeclaredSchema, description: "The blips a run declares" },
			],
		}),
		startExecution: async () => {
			await Promise.resolve();
			blipRollup.attach(this.getWorld().eventLogger);
		},
		endFeature: async () => {
			await Promise.resolve();
			blipRollup.reset();
		},
		endExecution: async () => {
			await Promise.resolve();
			blipRollup.detach();
			blipWatch.stop();
		},
	};

	steps: TStepperSteps = {
		watchBlips: {
			gwta: `watch blips {names: ${DOMAIN_BLIP_NAMES}}`,
			description:
				"Start collecting occurrences with the given names, in order. Names are comma separated; a dotted namespace matches everything under it (`haibun.http` matches `haibun.http.request`). Each name must be declared. Replaces any earlier watch. Read with `show watched blips`.",
			productsDomain: DOMAIN_BLIP_WATCH,
			action: async ({ names: watching }: { names: string[] }) => {
				await Promise.resolve();
				const declared = blipDeclarations().map((d) => d.name);
				const unknown = watching.filter((n) => !declared.some((d) => d === n || d.startsWith(`${n}.`)));
				if (unknown.length > 0) return actionNotOK(`watch blips: nothing declares ${unknown.join(", ")}; declared names are ${declared.join(", ") || "(none)"}`);
				blipWatch.start(this.getWorld().eventLogger, watching);
				return actionOKWithProducts({ watching, window: WATCH_WINDOW });
			},
		},
		stopWatchingBlips: {
			gwta: "stop watching blips",
			description: "Stop collecting. The window already collected stays readable until a new watch replaces it.",
			action: async () => {
				await Promise.resolve();
				blipWatch.stop();
				return OK;
			},
		},
		showWatchedBlips: {
			gwta: "show watched blips",
			description:
				"The watched occurrences as text. Opens with each name and value of its declared dimensions, counted over every occurrence recorded, with the total and largest of a measured value, then lists the window oldest first, each occurrence with its name, value, step path and attributes. Reports the total recorded and how many the window holds.",
			productsDomain: DOMAIN_WATCHED_BLIPS,
			action: async () => {
				await Promise.resolve();
				const held = blipWatch.occurrences();
				const totals = blipWatch.totals();
				return actionOKWithProducts({
					text: renderWatch(held, blipWatch.seen, totals),
					held: held.length,
					seen: blipWatch.seen,
					watching: [...blipWatch.names],
					totals: [...totals],
				});
			},
		},
		showDeclaredBlips: {
			gwta: "show declared blips",
			description:
				"Every name this run can record, with its description and, for declarations using `origin`, the `path:line` that declares it. Use it to find what is to watch and where its code is.",
			productsDomain: DOMAIN_DECLARED_BLIPS,
			action: async () => {
				await Promise.resolve();
				const declared = blipDeclarations();
				const text =
					declared.length === 0
						? "This run declares no blips."
						: declared.map((d) => `${d.name}${d.unit ? ` (${d.unit})` : ""}: ${d.description}${d.declaredAt ? ` [declared at ${d.declaredAt}]` : ""}`).join("\n");
				return actionOKWithProducts({ text, names: declared.map((d) => d.name) });
			},
		},
	};
}
