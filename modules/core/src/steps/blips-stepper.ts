/**
 * Steps and observation sources for blips. `lib/domains/blips.ts` implements recording.
 *
 * The rollup counts occurrences per name. The stepper attaches it when an actuality starts, clears it at the end of each
 * feature and detaches it when the actuality ends. A watch names blips and holds a bounded window of their occurrences
 * in order. The counts state how many occurrences each name had. The window states their order. `observed in` reads both
 * observation sources.
 */
import { listOf } from "../lib/domains/lists.js";
import { CountedFields, counted } from "../lib/domains/hypermedia.js";
import { AStepper, observedOf, type IHasCycles, type IObservationSource, type IStepperCycles, type TStepperSteps } from "../lib/steps/domains/stepper.js";
import { blipDeclarations, blipDeclared, blipRollup, blipWatch, renderOccurrence, WATCH_WINDOW, type TBlipSeries } from "../lib/domains/blips.js";
import { actionNotOK, actionOKWithProducts } from "../lib/domains/util.js";
import { OK } from "../lib/domains/protocol.js";
import type { TBlipEvent } from "../lib/domains/protocol.js";
import { z } from "zod";
import { listedSchema } from "../lib/domains/domains.js";

const WatchSchema = z.object({ watching: z.array(z.string()), window: z.number() });
const SeriesSchema = z.object({ name: z.string(), labels: z.record(z.string(), z.string()), count: z.number(), sum: z.number().optional(), max: z.number().optional() });
/** The watched occurrences as a list: the window's occurrences, oldest first, each with its position, and the count of every
 *  occurrence recorded. */
const ShowSchema = z.object({
	text: z.string(),
	occurrences: z.array(z.record(z.string(), z.unknown())),
	held: z.number(),
	seen: z.number(),
	watching: z.array(z.string()),
	totals: z.array(SeriesSchema),
	...CountedFields,
});
/** The declared blips as a list, each with its description, its unit and where it is declared, where it states them. */
const DeclaredSchema = z.object({
	text: z.string(),
	blips: z.array(z.object({ name: z.string(), description: z.string(), unit: z.string().optional(), declaredAt: z.string().optional() })),
	names: z.array(z.string()),
	...CountedFields,
});
/** The product domain of `watch blips`. */
const DOMAIN_BLIP_WATCH = "blip-watch";
/** The blips a watch names, as a list. A dotted namespace names every blip under it. */
const DOMAIN_BLIP_NAMES = "blip-names";
const DOMAIN_WATCHED_BLIPS = "watched-blips";
const DOMAIN_DECLARED_BLIPS = "declared-blips";

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
			// Counts occurrences per name, with one counter per recorded name. The rollup stays attached from startActuality to endActuality.
			name: "blips",
			observe: () => Promise.resolve(blipRollup.observe()),
		},
		{
			// The watched occurrences in order, each item starting with its position, so repeated occurrences stay distinct items.
			// Its functions are the declared attributes, so a quantifier reads occurrence/view and occurrence/reason, for example.
			// A reserved key that the occurrence carries replaces an attribute of the same name.
			name: "watched blips",
			observe: () =>
				Promise.resolve(
					blipWatch
						.occurrences()
						.flatMap((blip, i) => observedOf(renderOccurrence(blip, i), { ...blip.attributes, index: i + 1, name: blip.name, step: blip.seqPath, value: blip.value })),
				),
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
				{ selectors: [DOMAIN_WATCHED_BLIPS], schema: ShowSchema, list: listOf(ShowSchema, "occurrences"), description: "The occurrences a watch holds, and their totals" },
				{ selectors: [DOMAIN_DECLARED_BLIPS], schema: DeclaredSchema, list: listOf(DeclaredSchema, "blips"), description: "The blips actuality declares" },
			],
		}),
		startActuality: async () => {
			await Promise.resolve();
			blipRollup.attach(this.getWorld().eventLogger);
		},
		endFeature: async () => {
			await Promise.resolve();
			blipRollup.reset();
		},
		endActuality: async () => {
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
					occurrences: held.map((blip, i) => ({ ...blip.attributes, index: i + 1, name: blip.name, step: blip.seqPath, value: blip.value })),
					...counted(blipWatch.seen),
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
				const blips = declared.map(({ name, description, unit, declaredAt }) => ({ name, description, ...(unit ? { unit } : {}), ...(declaredAt ? { declaredAt } : {}) }));
				return actionOKWithProducts({ text, blips, names: declared.map((d) => d.name), ...counted(blips.length) });
			},
		},
	} as const satisfies TStepperSteps;
}
