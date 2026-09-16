/** A host's answer as the run sends one: JSON, with the status that says whether it served the call. */
export const rpcAnswer = (body: unknown, status: number): Response => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
