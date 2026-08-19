/**
 * The one statement of what passes between a reader's page and the issuing step: the key a page presents, and the
 * credential it receives. The step declares these as its input domain and products schema, and the page parses the
 * answer with the same schema, so the two sides cannot drift.
 */
import { z } from "zod";

/** What a reader presents: the public half of the key it controls and never sends, as a JSON Web Key. */
export const presentedKeySchema = z.looseObject({
	kty: z.string().min(1, "the presented key states no key type"),
	crv: z.string().min(1, "the presented key states no curve"),
	x: z.string().min(1, "the presented key carries no coordinate"),
	y: z.string().min(1, "the presented key carries no coordinate"),
});
export type TPresentedKey = z.infer<typeof presentedKeySchema>;

/** What a reader receives: the credential itself, what it allows, and when it stops holding. */
export const sessionCredentialSchema = z.object({
	keyId: z.string().optional().describe("What the credential names the reader's key by, which its signatures are made as."),
	credential: z.looseObject({ id: z.string() }).optional().describe("The credential the reader presents, issued to the key it controls."),
	allowedAction: z.array(z.string()).describe("What the reader may do, which is nothing where this deployment gives a reader nothing."),
	expires: z.string().optional().describe("When it stops holding."),
	record: z
		.object({ persistedAs: z.string(), id: z.string() })
		.optional()
		.describe("Where this deployment recorded what it issued, so a reader can open it and follow what it was granted from."),
});
export type TIssuedSession = z.infer<typeof sessionCredentialSchema>;
