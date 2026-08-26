/**
 * src/controllers — where component data access lives. READ THIS BEFORE ADDING A DATA-CONSUMING COMPONENT.
 *
 * Every ShuElement that reads data does it through a ReactiveController it HOLDS as a field — never by calling
 * `conduit()` / `requireStep()` / `findStep()` / `getStore()` itself. One resolution path per capability, composed
 * freely per view (hold as many controllers as the view needs), fully typed, no inheritance/mixin gymnastics:
 *
 *   class ShuFooColumn extends ShuElement<typeof FooSchema> {   // ← stays a plain ShuElement: typed this.state for free
 *     #query  = new QueryController(this);    // run graph queries (the `graphQuery` step; a graph store overrides the default)
 *     #entity = new EntityController(this, v => this.apply(v));  // one individual: entity + its annotations + provenance, kept fresh
 *     // render from this.#query.run(...) / this.#events.all — the view never touches the RPC layer
 *   }
 *
 * Adding a new data capability (a new kind of read)? Add a controller HERE and reuse the shared data layer
 * (the client cache / quads-snapshot / the query steps); do NOT reassemble RPC inside a component. `data-access.test.ts`
 * fails the build if a component reaches the raw RPC/store primitives directly — that test is the guardrail, this file
 * is the map.
 */
export { QueryController, type TQueryResult } from "./query-controller.js";
export { EntityController } from "./entity-controller.js";
export { AuthorityController, type TAuthority, type TPrincipalRow } from "./authority-controller.js";
