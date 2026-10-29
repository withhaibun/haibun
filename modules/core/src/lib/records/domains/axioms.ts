/**
 * The axioms of what a graph shows, in DL notation: one frame for each class, each property and each individual. A
 * frame states its Manchester syntax (W3C Note), which a source pane shows as text, and its axioms in DL notation, with the
 * statement behind it, the record that asserted it, and the nodes and edges of the graph it states.
 */
import { z } from "zod";
import { IndividualAddressSchema } from "../../domains/typed-links.js";

/** The symbols of DL notation the axioms and a claim's witness write, which a graph's labels draw: subsumption and its failure,
 *  the existential and universal restrictions, union, intersection, the top class, membership and its failure, and entailment. */
export const DL_SYMBOL = { subsumedBy: "⊑", notSubsumedBy: "⋢", some: "∃", all: "∀", union: "⊔", intersection: "⊓", top: "⊤", member: "∈", notMember: "∉", entails: "⊨" } as const;

/** What a claim of subsumption the records don't prove names as its witness: the subsumption in DL notation, the narrower and
 *  the wider class expression as the claim writes them, and the records the narrower holds and the wider doesn't. */
export const ClaimWitnessSchema = z.object({ subsumption: z.string(), sub: z.string(), sup: z.string(), members: z.array(IndividualAddressSchema) }).strict();
export type TClaimWitness = z.infer<typeof ClaimWitnessSchema>;

/** The kinds of frame, as Manchester syntax names them. */
export const FRAME_KIND = { class: "Class", property: "ObjectProperty", individual: "Individual" } as const;
const AssertedBySchema = z.object({ persistedAs: z.string(), id: z.string() }).strict();
const FrameSchema = z
	.object({
		/** The frame's kind and the term it describes, which names its line. */
		name: z.string(),
		kind: z.enum(FRAME_KIND),
		manchester: z.string(),
		dl: z.string(),
		statement: z.string(),
		assertedBy: AssertedBySchema.optional(),
		/** An individual's types the ontology entails beside the one its record asserts: its type's superclasses. */
		entailed: z.array(z.string()).optional(),
		nodes: z.array(z.string()),
		edges: z.array(z.object({ from: z.string(), label: z.string(), to: z.string() }).strict()),
	})
	.strict();
export type TFrame = z.infer<typeof FrameSchema>;
/** A graph's axioms: their Manchester text, the count of its frames of each kind, and its frames. */
export const GraphAxiomsSchema = z
	.object({
		text: z.string(),
		summary: z.object({ classes: z.number().int(), properties: z.number().int(), individuals: z.number().int() }).strict(),
		frames: z.array(FrameSchema),
	})
	.strict();
export type TGraphAxioms = z.infer<typeof GraphAxiomsSchema>;
/** The domain of a graph's axioms, which the step that returns them declares. */
export const DOMAIN_GRAPH_AXIOMS = "graph-axioms";
