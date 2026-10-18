/**
 * An in-memory store that reads the records of an actuality's types, for a test that writes an actuality and reads it through a view.
 */
import type { TDomainDefinition } from "@haibun/core/lib/resources.js";
import { storeOfDomains } from "@haibun/core/lib/test/declared-types.js";
import { seqPathDomainDefinition } from "@haibun/core/lib/seq-path.js";
import { logMessageDomainDefinition } from "@haibun/core/lib/domains/log-message.js";
import { runArtifactDomainDefinition } from "@haibun/core/lib/domains/run-artifact.js";

/** The declarations of the types actuality writes as it runs: its steps, what it logged and what it produced. */
export const ACTUALITY_DOMAIN_DEFINITIONS: TDomainDefinition[] = [seqPathDomainDefinition, logMessageDomainDefinition, runArtifactDomainDefinition];

/** Returns an in-memory store that reads the records of an actuality's types. */
export const actualityStore = () => storeOfDomains(ACTUALITY_DOMAIN_DEFINITIONS);
