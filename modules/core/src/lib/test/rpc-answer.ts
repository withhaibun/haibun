/** A host's answer as actuality sends one: JSON, with the status that states whether it served the call. */
export const rpcAnswer = (body: unknown, status: number): Response => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
