/**
 * Steps and observation sources for blips. `lib/blips.ts` implements recording.
 *
 * The rollup counts occurrences per name. The stepper attaches it when an execution starts, clears it at the end of each
 * feature and detaches it when the execution ends. A watch names blips and holds a bounded window of their occurrences
 * in order. The counts state how many occurrences each name had. The window states their order. `observed in` reads both
 * observation sources.
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
/** The product domain of `watch blips`. */
const DOMAIN_BLIP_WATCH = "blip-watch";
/** The blips a watch names, as a list. A dotted namespace names every blip under it. */
const DOMAIN_BLIP_NAMES = "blip-names";
const DOMAIN_WATCHED_BLIPS = "watched-blips";
const DOMAIN_DECLARED_BLIPS = "declared-blips";

/** Renders one occurrence as a line: ordinal, name, value, step, attributes. */
export function renderOccurrence(blip: TBlipEvent, index: number): string {
	const detail = Object.entries(blip.attributes ?? {}).map(([k, v]) => `${k}=${String(v)}`);
	const parts = [`${index + 1}`, blip.name, ...(blip.value === undefined ? [] : [`value=${blip.value}`]), ...(blip.seqPath ? [`step=${blip.seqPath}`] : []), ...detail];
	return parts.join(" ");
}

/** Rounds a shown value to a tenth. A reading of a total doesn't need a finer value. */
const shown = (value: number) => Number(value.toFixed(1));

/** Renders one series as a line: its name, its dimension values and its count. A measured series adds its total and its
 *  largest value in the declared unit. */
function renderSeries(series: TBlipSeries): string {
	const labels = Object.entries(series.labels).map(([dimension, value]) => ` ${dimension}=${value}`);
	const unit = blipDeclared(series.name)?.unit;
	const inUnit = (value: number) => `${shown(value)}${unit ? ` ${unit}` : ""}`;
	const measured = series.sum === undefined || series.max === undefined ? "" : `, ${inUnit(series.sum)} in all, largest ${inUnit(series.max)}`;
	return `${series.name}${labels.join("")}: ${series.count}${measured}`;
}

/** Renders the watch as text: the total recorded, each series over every recorded occurrence, and the window, oldest first. */
export function renderWatch(occurrences: readonly TBlipEvent[], seen: number, totals: readonly TBlipSeries[]): string {
	if (seen === 0) return "The watch didn't record an occurrence of a watched name.";
	const dropped = seen - occurrences.length;
	return [
		`${seen} occurrence(s) recorded. By name and dimension, over all of them:`,
		...totals.map(renderSeries),
		`In order${dropped > 0 ? `, showing the most recent ${occurrences.length}` : ""}, oldest first:`,
		...occurrences.map(renderOccurrence),
	].join("\n");
}

export default class BlipsStepper extends AStepper implements IHasCycles {
	description = "Fine-grained occurrences actuality records and doesn't retain: per-name counts, and an ordered window over watched names";

	private sources: IObservationSource[] = [
		{
			// Counts occurrences per name, with one counter per recorded name. The rollup stays attached from startExecution to endExecution.
			name: "blips",
			observe: () => Promise.resolve(blipRollup.observe()),
		},
		{
			// Returns the watched occurrences in order. Each item starts with its position, so repeated occurrences stay distinct items.
			// The declared attributes become metrics, so a quantifier binds occurrence/view and occurrence/reason, for example.
			// A reserved key that the occurrence carries replaces an attribute of the same name.
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
				{ selectors: [DOMAIN_BLIP_WATCH], schema: WatchSchema, description: "The blips a watch names, and the size of its window" },
				{
					selectors: [DOMAIN_BLIP_NAMES],
					schema: listedSchema(z.string().min(1), "blip"),
					description: "The blips a watch names, given as a list or as text separated by commas. A dotted namespace names every blip under it",
				},
				{ selectors: [DOMAIN_WATCHED_BLIPS], schema: ShowSchema, description: "The occurrences a watch holds, and their totals" },
				{ selectors: [DOMAIN_DECLARED_BLIPS], schema: DeclaredSchema, description: "The blips actuality declares" },
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

	steps = {
		watchBlips: {
			gwta: `watch blips {names: ${DOMAIN_BLIP_NAMES}}`,
			description:
				"Start collecting occurrences with the given names, in order. Names are comma separated. A dotted namespace matches every name under it (`haibun.http` matches `haibun.http.request`). Each name must be declared. Replaces any earlier watch. Read with `show watched blips`.",
			productsDomain: DOMAIN_BLIP_WATCH,
			action: async ({ names: watching }: { names: string[] }) => {
				await Promise.resolve();
				const declared = blipDeclarations().map((d) => d.name);
				const unknown = watching.filter((n) => !declared.some((d) => d === n || d.startsWith(`${n}.`)));
				if (unknown.length > 0)
					return actionNotOK(
						`watch blips: ${unknown.join(", ")} isn't declared; ${declared.length > 0 ? `declared names are ${declared.join(", ")}` : "actuality doesn't declare a name"}`,
					);
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
				"Show the watched occurrences as text. The text states the total recorded, then a count for each name and each value of its declared dimensions over every recorded occurrence. A measured series adds its total and its largest value. The text then lists the window oldest first. Each line holds an occurrence's position, name, value, step path and attributes. The products hold the total recorded and the number of occurrences the window holds.",
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
				"List every blip name actuality can record, with its description. A declaration that uses `origin` adds the `path:line` that declares it. Use it to find a name to watch and the code that declares it.",
			productsDomain: DOMAIN_DECLARED_BLIPS,
			action: async () => {
				await Promise.resolve();
				const declared = blipDeclarations();
				const text =
					declared.length === 0
						? "Actuality doesn't declare a blip."
						: declared.map((d) => `${d.name}${d.unit ? ` (${d.unit})` : ""}: ${d.description}${d.declaredAt ? ` [declared at ${d.declaredAt}]` : ""}`).join("\n");
				return actionOKWithProducts({ text, names: declared.map((d) => d.name) });
			},
		},
	} as const satisfies TStepperSteps;
}
