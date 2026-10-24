/**
 * The ports of the transport: what proves a call, a method of an `/rpc` method family, and a remote host's steps as a
 * proxy calls them.
 */
import type { TAction } from "../domains/actions.js";
import type { THandshake, TRemoteCall } from "./domains/rpc-wire.js";

/** Computes the headers that prove a call. It reads the request as it is sent: its URL, method, headers and body. */
export type TProveRequest = (request: { url: string; method: string; headers: Record<string, string>; body: string }) => Promise<Record<string, string>>;

/** One method of an `/rpc` method family. `action` names the action a caller must invoke. `handle` computes the call's result. */
export type TRpcMethod = { action: TAction; handle: (params: Record<string, unknown>) => Promise<unknown> };

/** A remote host's steps as a proxy calls them: the handshake that begins the surface, and each step's call, signed for
 *  the action it invokes where it invokes one. */
export type TRemoteSteps = {
	handshake(): Promise<THandshake>;
	call(method: string, params: Record<string, unknown>, seqPath: number[], action: string | undefined): Promise<TRemoteCall>;
};
