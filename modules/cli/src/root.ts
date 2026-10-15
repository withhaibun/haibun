/**
 * The composition root of the cli: the sign-ins this process holds for the sites of the instances it starts, which every
 * call it makes to such a site carries.
 */
import type { TBasicAuthUser } from "@haibun/core/lib/basic-auth.js";
import { holdSignIn, releaseSignIn } from "@haibun/core/lib/transport/adapters/rpc-call.js";

/** The sign-in each call to an instance's origin carries, held until the instance stops. */
export const instanceSignIns = { hold: (origin: string, user: TBasicAuthUser): void => holdSignIn(origin, user), release: (origin: string): void => releaseSignIn(origin) };
