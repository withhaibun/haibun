/**
 * The run-facing surface of the blip channel: what a feature asserts on, and what an agent asked to watch something
 * calls. Recording lives in `lib/blips.ts`; this offers it to a run.
 *
 * Two readings, because they answer different questions. The rollup counts occurrences per name for the whole run and
 * is always on, which is cheap and says how much happened. A watch is asked for by name and holds a bounded ordered
 * window, which is what says in what order it happened, the question a count cannot answer and the reason the channel
 * exists. Both are served as observation sources, so a feature reads them through the `observed in` quantifiers that
 * already exist rather than through a surface of their own.
 */
import { AStepper, type IHasCycles, type IObservationSource, type IStepperCycles, type TStepperSteps } from "../lib/astepper.js";
import { blipDeclarations, blipRollup, blipWatch, WATCH_WINDOW } from "../lib/blips.js";
import { actionNotOK, actionOKWithProducts } from "../lib/util/index.js";
import { OK } from "../schema/protocol.js";
import type { TBlipEvent } from "../schema/protocol.js";
import { z } from "zod";

const WatchSchema = z.object({ watching: z.array(z.string()), window: z.number() });
const ShowSchema = z.object({ text: z.string(), held: z.number(), seen: z.number(), watching: z.array(z.string()) });
const DeclaredSchema = z.object({ text: z.string(), names: z.array(z.string()) });

/** One occurrence as a line a person or a model reads: what happened, under which step, with what detail. */
export function renderOccurrence(blip: TBlipEvent, index: number): string {
	const detail = Object.entries(blip.attributes ?? {}).map(([k, v]) => `${k}=${String(v)}`);
	const parts = [`${index + 1}`, blip.name, ...(blip.value === undefined ? [] : [`value=${blip.value}`]), ...(blip.seqPath ? [`step=${blip.seqPath}`] : []), ...detail];
	return parts.join(" ");
}

/** The window as text, oldest first, saying what it holds and what it dropped rather than presenting a truncation as the whole. */
export function renderWatch(occurrences: readonly TBlipEvent[], seen: number): string {
	if (seen === 0) return "No occurrences were recorded for the watched names.";
	const dropped = seen - occurrences.length;
	const head = `${seen} occurrence(s) recorded${dropped > 0 ? `, showing the most recent ${occurrences.length}` : ""}, oldest first:`;
	return [head, ...occurrences.map(renderOccurrence)].join("\n");
}

export default class BlipsStepper extends AStepper implements IHasCycles {
	description = "Fine-grained occurrences a run records but never retains: their per-name counts, and an ordered window over the ones being watched";

	private sources: IObservationSource[] = [
		{
			// How many of each occurred. Always on, and bounded by the declared vocabulary since a name is the only key.
			name: "blips",
			observe: () => Promise.resolve(blipRollup.observe()),
		},
		{
			// In what order they occurred. Each item carries its position, so an item repeated at two moments stays two items.
			// The declared attributes ride along as metrics, so a quantifier binds e.g. occurrence/view and occurrence/reason;
			// the reserved keys win a collision, since they are what every occurrence answers for.
			name: "watched blips",
			observe: () => {
				const held = blipWatch.occurrences();
				const metrics: Record<string, Record<string, unknown>> = {};
				const items = held.map((blip, i) => {
					const item = renderOccurrence(blip, i);
					metrics[item] = { ...blip.attributes, index: i + 1, name: blip.name, ...(blip.seqPath ? { step: blip.seqPath } : {}), ...(blip.value === undefined ? {} : { value: blip.value }) };
					return item;
				});
				return Promise.resolve({ items, metrics });
			},
		},
	];

	cycles: IStepperCycles = {
		getConcerns: () => ({ sources: this.sources }),
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
			gwta: "watch blips {names: string}",
			description:
				"Start collecting the named fine-grained occurrences in order, so what happened after what can be read. Names are comma separated, and a dotted namespace collects everything under it (watching `haibun.http` collects `haibun.http.request`). Every name must already be declared. Replaces any earlier watch. Read the result with `show watched blips`.",
			productsSchema: WatchSchema,
			action: async ({ names }: { names: string }) => {
				await Promise.resolve();
				const watching = names
					.split(",")
					.map((n) => n.trim())
					.filter((n) => n.length > 0);
				if (watching.length === 0) return actionNotOK("watch blips: name at least one blip to watch");
				const declared = blipDeclarations().map((d) => d.name);
				const unknown = watching.filter((n) => !declared.some((d) => d === n || d.startsWith(`${n}.`)));
				if (unknown.length > 0) return actionNotOK(`watch blips: nothing declares ${unknown.join(", ")}; declared names are ${declared.join(", ") || "(none)"}`);
				blipWatch.start(this.getWorld().eventLogger, watching);
				return actionOKWithProducts({ watching, window: WATCH_WINDOW });
			},
		},
		stopWatchingBlips: {
			gwta: "stop watching blips",
			description: "Stop collecting occurrences. The window already collected stays readable until a new watch replaces it.",
			action: async () => {
				await Promise.resolve();
				blipWatch.stop();
				return OK;
			},
		},
		showWatchedBlips: {
			gwta: "show watched blips",
			description:
				"The watched occurrences in order, oldest first, as text: what happened, under which step, and with what detail. Says how many were recorded and how many the bounded window holds, so a truncation never reads as the whole.",
			productsSchema: ShowSchema,
			action: async () => {
				await Promise.resolve();
				const held = blipWatch.occurrences();
				return actionOKWithProducts({ text: renderWatch(held, blipWatch.seen), held: held.length, seen: blipWatch.seen, watching: [...blipWatch.names] });
			},
		},
		showDeclaredBlips: {
			gwta: "show declared blips",
			description: "Every occurrence this run can record, with what one recording means and what detail it carries. Read this to find out what is worth watching.",
			productsSchema: DeclaredSchema,
			action: async () => {
				await Promise.resolve();
				const declared = blipDeclarations();
				const text = declared.length === 0 ? "This run declares no blips." : declared.map((d) => `${d.name}${d.unit ? ` (${d.unit})` : ""}: ${d.description}`).join("\n");
				return actionOKWithProducts({ text, names: declared.map((d) => d.name) });
			},
		},
	};
}
