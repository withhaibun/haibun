# Open-world reasoning in haibun

Status: design, from a trial on 2026-10-26. It read haibun at `fe9096eae` and an application built on it. The trial didn't change either repository. The trial's scripts and outputs are in `reasoner-trial/` beside this file.

## Conclusions

- Knowledge moves to the open world, where `unknown` is a result. Observations of actuality stay closed, as checks scoped to a named graph.
- Use EYE (N3) on the swipl-wasm 8.2.3 runtime haibun already ships, loaded on first use. It doesn't need threads or SharedArrayBuffer, and it determined every policy case in the trial, with a proof.
- Konclude stays in reserve for full OWL 2 DL classification, and only if a need appears. In the browser it requires cross-origin isolation. Its wasm build misses entailments haibun needs: dateTime facets, and subsumptions from data ranges and cardinalities through its entailment API.
- The standards:
  - OWL 2, as an RL-sized vocabulary, states the knowledge.
  - Scoped negation over a named graph (`log:notIncludes`) checks actuality. EYE covers SHACL's core checks, so a SHACL engine isn't needed. SHACL remains an option for interchanging shapes.
  - ODRL 2.2 gives capabilities their meaning, through alignment axioms over ZCAP-LD's JSON-LD terms.
- Removed:
  - The Prolog knowledge path: goals, waypoint rules, falsity, `sameAs` and the chain lint.
  - The TPTP projection.
  - `docs/planning/fol-in-haibun.md`.
- The step readings in `haibun.pl` stay as the closed proof of a line over actuality. One correction: `not` of an `unknown` is `unknown`.

## 1. Closed-world assumptions

Classes:
- **A**: an observation of actuality. It stays closed, as a check scoped to a named graph.
- **K**: knowledge. It moves to the open world, where `unknown` is a result.
- **O**: authority. Object capabilities deny by default and only narrow, so it stays closed by design, as ODRL permission containment.

### Engine and pipelines

| # | Site | Assumption | Class | Target |
|---|------|------------|-------|--------|
| 1 | `logic/src/adapters/haibun.pl:65-68,103` `naf/2`, `reading(not)` | negation as failure; `naf(unknown, proved)` | A | stays closed; `naf(unknown, unknown)` |
| 2 | `haibun.pl:104-107` `where` | a condition not proved is false | A | stays; N3 export already writes `log:notIncludes` (`:329`) |
| 3 | `haibun.pl:144-152` `whenever` | a condition not proved ends the repetition | A | stays (`:332`) |
| 4 | `haibun.pl:112-116` `some` | an empty member read refutes | A for an observation source; K for a domain | K: `unknown` unless the domain is closed (`owl:oneOf`, an `ordered set of`) |
| 5 | `haibun.pl:118-120,138-141` `every`, `for_all` | the rows read are every member | A / K as #4 | as #4 |
| 6 | `haibun.pl:135` `members/4` | a member read is complete | A / K | read through the named graph that states completeness |
| 7 | `haibun.pl:61-63,79` `outcome_verdict` | a step passed or failed | A | stays |
| 8 | `haibun.pl:186-192` `stated/8` | a goal is refuted only by a stated falsity, else `unknown` | K | already open; becomes an N3 falsity, or `owl:NegativePropertyAssertion` |
| 9 | `haibun.pl:217,229,244` `none/1` in goal plans | a plan whose inputs are all available exists, by failure | K | N3 backward rules; a missing plan is `unknown` |
| 10 | `haibun.pl:227` `Held = false` | a domain that the facts read don't support doesn't hold | K | `unknown` |
| 11 | `haibun.pl:252` `proof(..., argument)` | a domain that steps don't return is a caller's argument | K (a default standing in for a fact) | an explicit `t:suppliedBy t:caller` rule |
| 12 | `haibun.pl:277-281` lint `none(produced …)` | the step declarations are complete | A (the build's declarations) | N3 scoped negation over the step-graph formula |
| 13 | `haibun.pl:327-340` N3 export | `?scope log:notIncludes` | A | already scoped; the bridge to EYE exists |
| 14 | `logic/src/pipelines/goals.ts:76` | a missing fact and plan is `refuted` | K | `unknown` |
| 15 | `goals.ts:216`, `derivations/goals.ts:156` `forwardOf` | affordances over the facts read, the steps a caller may call | K over facts, O over steps | facts open; steps as ODRL containment |
| 16 | `logic/src/pipelines/reads.ts:17-33` `readerOf` | `store.query` under the caller's authority is the whole graph | K | a read at a bound states the bound, so absence under a bound is `unknown`, as a refusal already is |
| 17 | an application's read of records under a ceiling | at most the ceiling's count of records per read, taken as complete | K | a truncated read states the truncation, which makes the result `unknown` |
| 18 | `core/src/lib/records/pipelines/ontology-records.ts:86` | an absent `inData` is `true` | K (a default) | state it on every term at derivation |
| 19 | `core/src/lib/domains/actions.ts:208` `delegatedActions` | an absent `allowedAction` is every action | O (ZCAP-LD's own rule) | `odrl:use`, the top action |
| 20 | `core/src/lib/domains/actions.ts:111-121,225-233` `capabilityAllows`, `actionUnder` | what a capability doesn't allow is refused | O | ODRL containment as N3 rules (section 2.3) |

### Steps in features and waypoints

Counts are of lines in `*.feature` and `*.feature.ts`, by pattern, excluding prose.

| Step | haibun | Application | Class | Note |
|------|-------:|------:|-------|------|
| `not …` | 27 | 10 | A 32, K 3, O 2 | K: `not ensure …` (requirements 03:52, 03:61, 04:47); O: `not holding capability …` (requirements 02:39, 02:46) |
| `absent …` | 1 | 0 | K | requirements 04:46; the step is at `logic-stepper.ts:122-141` |
| `every … observed in …` | 6 | 3 | A | the steps waypoint (`logic/waypoints/backgrounds/steps.feature.ts:10`), http-trace, visited pages, blips |
| `some … observed in …` | 4 | 8 | A | |
| `every x in D …` | 1 | 1 | K, or closed where D is declared closed | requirements 04:24, and one line of an application |
| `some x in D …` | 7 | 0 | K, or closed as above | |
| `where …, …` | 17 | 25 | A | |
| `resolve`, `pursue`, `walk toward` | 13 | 13 | K | goal planning |
| affordances | 25 | 6 | K over facts, O over steps | |

Totals: engine and pipeline sites 20: A 6, K 8, O 2, and 4 split (rows 4 to 6 are A or K by source; row 15 is K over facts and O over steps). Step lines 167: A 95, K 70, O 2. The `every`/`some x in D` lines and the affordance lines count as K.

## 2. Target model

### 2.1 Knowledge (OWL 2)

- The ontology comes from `ontologyToQuads` (`core/src/lib/records/derivations/ontology.ts:87`), exported as OWL. The trial's export over an application's 21 steppers gave 244 domains, 902 quads, 52 classes, 112 properties and 361 Turtle lines.
- A class's declared `type` is the JSON-LD `@type` of its records. It exports as `rdfs:subClassOf` that IRI, not as the class itself: 41 types name an IRI, and several share one (`prov:Entity`).
- A relation's `domain` and `range` edges list every declaring type, which is a union. Several `rdfs:domain` axioms would state an intersection, so they export as `owl:unionOf`. The current records would be wrong under OWL's semantics if exported naively.
- A blank class expression is typed `owl:Class` (the OWL 2 RDF mapping). Without the typing, Konclude silently drops the expression.
- CURIEs expand through the served `@context` (`getJsonLdContext`), one source.
- The profile is OWL 2 RL, which N3 rules evaluate: subclass, subproperty, domain and range unions, `owl:equivalentProperty`, `owl:sameAs`, `owl:oneOf` for declared closed sets.

### 2.2 Actuality (closed checks)

Actuality's records of a run are one named graph. A check is scoped negation over that graph, tested in EYE:

| SHACL construct | N3 form | Trial |
|---|---|---|
| `sh:minCount 1` | `?g log:includes {?s a C} . ?g log:notIncludes {?s p ?o}` | found a step without `seqPath` and one without `verdict` |
| `sh:closed` | `?g log:includes {?s ?p ?o}` and `log:notEqualTo` for each allowed property | found `t:note` |
| `every … observed` (∀) | the scoped negation of a counterexample | `everyStepHasVerdict` not derived, correctly |

`log:forAllIn` makes this EYE build start a second EYE through `exec`, which wasm can't do. ∀ is stated as a negated counterexample instead. A SHACL engine isn't needed. SHACL stays an option for publishing shapes.

### 2.3 Capabilities (ODRL)

- **Format.** Capabilities stay ZCAP-LD documents: signed, stored and used, through `@digitalbazaar/zcap`. ZCAP-LD is a W3C CCG draft. ODRL 2.2 is a W3C Recommendation. N3 is a W3C Community Group specification.
- **Meaning.** Alignment axioms give ZCAP's terms their ODRL meaning, without a translation layer:
  - `sec:invocationTarget owl:equivalentProperty odrl:target`
  - `sec:allowedAction` ≡ `odrl:action`
  - `sec:controller` ≡ `odrl:assignee`
  - the parent's controller is `odrl:assigner`
  - `expires` and caveats are `odrl:constraint`
- **Scope.** Only permissions and constraints apply. Prohibitions and duties don't, because a capability only narrows authority.
- **One query.** Attenuation (child ⊑ parent), a delegate's grant over a list, and boundary containment (candidate ⊑ boundary) are one containment query. A candidate is contained where every action, target and expiry is within its bound. The witness is the exceeding `("action" a)`, `("target" t)` or `("expires" e)`.
- **The action grammar as rules.**
  - `*` allows every action.
  - An entry allows the action itself.
  - A prefix ending in `*` allows every action it begins (string built-ins).
  - A read at a level allows each narrower level.
- **Targets.** A target is contained at or under a path, as `actionUnder` holds now.
- **Expiry.** `math:greaterThan` compares `xsd:dateTime` values.

### 2.4 Mapping of haibun constructs

| haibun | Standard construct |
|---|---|
| a persisted type, `subClassOf`, a link relation | `owl:Class`, `rdfs:subClassOf`, `owl:ObjectProperty` with union domain and range |
| `is the same as` | `owl:sameAs` |
| `absent {goal}` | a stated falsity; N3 `t:falsity`, or `owl:NegativePropertyAssertion` |
| waypoint (head ⇐ proof, activity) | N3 backward rule `{head} <= {proof}`. A proof's step call is the built-in `h:call` and a read is `h:read`, both yielding modules/logic's effects |
| `resolve`, `pursue`, `walk toward`, affordances | N3 backward rules over producer signatures. A missing proof is `unknown` |
| chain lint | N3 scoped negation over the step-graph formula |
| `every … observed`, `some … observed`, `not`, `where`, `whenever`, `until` | stay in `haibun.pl` as the proof of a line over actuality; already exported as N3 with scoped negation |
| `every x in D`, `some x in D` | K: `unknown` unless D is closed (`owl:oneOf`) |
| `holding capability`, delegation, a delegate's grant, `capabilityAllows`, `actionUnder`, `narrowing` | ODRL containment in N3 (section 2.3) |
| `rule {formula}` (TPTP) | removed; a rule is N3 |
| `show graph {view} as tptp` | the DL view (stage 7) |

## 3. Reasoner choice

Trial in Node 24 over the same records: the exported ontology, and a ZCAP chain with expiry (root → c1 → c2…c5) plus a delegate's grant over a list with two candidate grants to a second delegate.

| | Konclude (`rdf-reasoner-konclude` 0.8.0) | EYE 11.24.8 on haibun's swipl-wasm 8.2.3 |
|---|---|---|
| Licence | LGPL-3.0-or-later (wrapper and Konclude, University of Ulm); its Qt-derived containers are LGPL-2.1 or GPL-3. A separately loaded `.wasm` keeps relinking possible | MIT (EYE); swipl-wasm BSD-2 |
| Size | wasm 11.86 MB (2.47 MB gz), package 12.5 MB, plus `n3` | already shipped: swipl-web.wasm 2.28 MB (0.82 MB gz) and .data 1.66 MB (1.18 MB gz); `eye.qlf` 202 KB (69 KB gz), already a haibun fixture |
| Threads | pthreads required (section 3.1) | single-threaded; `swipl-web.js` doesn't reference SharedArrayBuffer |
| Cold load | 0.8–1.2 s | 0.22–0.38 s |
| Memory (RSS) | 575 MB after load, 820 MB after the first reasoning, 960 MB peak | 120–130 MB after load, 141 MB after reasoning |
| Ontology (1,279 triples) | consistency 0.57–0.63 s; classification 12 ms (46 inferred) | rules plus records in 182–185 ms |
| Policy cases | correct only through satisfiability of C ⊓ ¬B, with expiry as epoch-second integers; `isEntailed` and `classify` missed Max5 ⊑ Max10, Before1115 ⊑ Before1201 and C2 ⊑ C1 | all 7 expected results derived: c2 ⊑ c1, c1 ⊑ root, subGrantPart ⊑ listGrant; c3 exceeds target, c4 action, c5 expiry, subGrantRemove action |
| dateTime constraint | `xsd:dateTime` facets not evaluated (C ⊓ ¬B reported satisfiable); `xsd:dateTimeStamp` stalled the kernel | evaluated by `math:greaterThan` |
| Count constraint | integer facets evaluated by satisfiability; cardinality subsumption only by satisfiability | integer comparison built-ins; cardinality reasoning absent |
| Witness | containment: a justification of C ⊓ ¬B's unsatisfiability, 32 raw RDF triples with blank nodes, in 43 s on 380 triples; on 1,600 triples `validate` didn't finish in 15 min. Exceeding: one authored satisfiability query per dimension (correct for c3, c4, c5 and withdraw) | the exceeding term itself, plus an `r:Proof` (540 lines) whose negation names its scope, `((sources) 1) log:notIncludes {…}` |
| Open world | `inv1 : Root` and `inv1 : ¬Root` both not entailed: `unknown`, correctly. `inv2 : C1` not entailed although it holds, so realization with a data restriction is incomplete | N3 is open by default. Negation is only scoped, and every scope is named |
| Reads | its own N3.js store per call | a waypoint's body read haibun's IQuadStore (a test world's `world.shared.getStore()`) through an `h:read` built-in that yields a read effect; 5 effects, 22–27 ms, without a second store |
| Waypoints | none | backward rules with `h:call` yielding a step call, its outcome posted back (`engine_yield`/`engine_post`, as `effect/4` does) |
| Full DL | yes (SROIQ(D) tableau) | OWL 2 RL by rules only, without reasoning by case over unions, from existentials or from cardinalities |

**Choice:** EYE, on the existing swipl-wasm runtime, with `eye.qlf` promoted from fixture to a runtime asset loaded on first use, as pglite loads. The npm `eyereasoner` package isn't used. It pins swipl-wasm 7.0.10 (a second runtime) and `n3` 2.x, which conflicts with `rdf-reasoner-konclude`'s `n3` 1.x peer at install. Konclude is held in reserve for full DL classification only.

### 3.1 Konclude threading verdict

- Its build links with `-pthread -sUSE_PTHREADS=1 -sPTHREAD_POOL_SIZE=32 -sENVIRONMENT=node,worker -sINITIAL_MEMORY=1073741824 -sMAXIMUM_MEMORY=4294967296` (`emscripten.cmake`).
- A threadless build isn't feasible. Konclude is an actor system whose KPSet classifier spin-waits for results from parallel tasks. The wrapper's author replaced the threads with cooperative single-thread dispatch. That build deadlocked in the KPSet subsumption phase on the Roberts family and GALEN ontologies, after six rounds of workarounds (`docs/solutions/architecture-patterns/wasm-pthread-concurrency-architecture-2026-05-08.md`). The trial didn't rebuild it: a Docker build takes 20–30 minutes, and the source shows the cause.
- **What a PWA would need.** These are workarounds, and both are strictly necessary for Konclude:
  - `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`) on every document. Every cross-origin subresource then needs CORP or CORS.
  - COOP `same-origin` severs `window.opener` with cross-origin pop-ups, which affects redirects that return from a cross-origin page.
  - A static host without header control needs a service worker that adds the headers.
  - The browser extension declares `cross_origin_embedder_policy` and `cross_origin_opener_policy` in its MV3 manifest.
- In the browser it runs only in a worker. A known browser deadlock existed in its v0.7.0.

## 4. Staged migration

Each stage keeps both repos' suites green and is one commit pair. Line counts are source estimates: removed / added.

| Stage | Change | Removed | Added |
|---|---|---:|---:|
| 1 | `haibun.pl`: `naf(unknown, unknown)`. `some` and `every` over a domain read that doesn't state it's closed return `unknown`. Goal verdict `unknown` where a fact and a plan are both missing (`goals.ts:76`). Features expecting `refuted` updated | 6 | 14 |
| 2 | EYE as a runtime: `eye.qlf` moves from `fixtures/` to the module, with its own swipl-wasm instance started on first use. A query queue, because EYE's `main` isn't re-entrant: a second run in one runtime failed on its temporary file, and a user built-in is called during scoped negation, so built-ins check `engine_self/1`. `h:read` and `h:call` yield the existing effects of `pipelines/prove.ts` | 0 | 160 |
| 3 | The OWL export of the ontology records: union domain and range, `@type` as superclass, typed blank expressions. Served beside `@context`, and read by `show ontology` | 0 | 90 |
| 4 | Capabilities: the alignment axioms and containment rules as an N3 library of `@haibun/core`. The gate's `capabilityAllows`, `actionUnder` and `narrowing` return through it, and a refusal returns the witness. Pages send the query to the instance rather than loading EYE, so bundle budgets don't grow | 110 | 70 (N3) + 40 |
| 5 | Goals and affordances as N3 backward rules over producer signatures; `resolve`, `pursue`, `walk toward` and affordances read them | 55 (Prolog, `haibun.pl:208-262`) + 90 (`goals.ts`, `derivations/goals.ts`) | 60 (N3) + 50 |
| 6 | Waypoints as N3 backward rules with `h:call`; `absent` as a stated falsity; `is the same as` as `owl:sameAs`; the chain lint as scoped negation over the step-graph formula. Removes `applied`, `stated`, `plan` and `lint` from `haibun.pl`, and `canonicalOf` | 120 (Prolog) + 70 | 70 (N3) + 40 |
| 7 | The DL view (section 5) replaces the TPTP projection | 840 | 290 |
| 8 | Removes `docs/planning/fol-in-haibun.md`, `formula.test.ts` and `term-graph.test.ts` (238 test lines), and the `rule {formula}` step | 12 | 0 |

Net source: about −1,300 / +880. `haibun.pl` falls from 341 to about 150 lines: the readings of a line and the N3 export. Steps removed: `rule {formula}` and `show graph {view} as tptp`, replaced by the ontology read's DL rendering (without a new single-purpose step).

## 5. The DL view (stage 7)

**Removed** (≈840 source lines, plus 238 test lines):
- logic: `derivations/formula.ts` (354), `derivations/term-graph.ts` (112), the TPTP faces of `derivations/registry.ts` (≈40), the formula reads of `pipelines/registry-reads.ts` (≈40), `producerAxioms` in `derivations/goals.ts` (≈50), the projection schemas in `domains/logic.ts` (≈30), the `rule` step (≈12).
- shu: `derivations/graph-formulas.ts` (56), `graphTptp` (≈25) and `showGraphAsTptp` (≈12), `page/graph/domains/sources.ts` (15), `page/graph/derivations/term-scene.ts` (28), the `terms` choice and its variable rings and ∀ badges in `shu-polymorphic-graph-view.ts` and `views.ts` (≈64).
- `source-lines.ts` (74) and `shu-graph-source.ts` (142) are kept and read the new text.

**Already supplied:**
- `shu-class-browser.ts` draws classes and properties as a graph, with type-only, all-types and `@context` tabs.
- `ontologyRead` lists each class with its superclasses, properties and edge ranges, and each property with its domain, range and super-properties.
- `withOntologySchema` carries the schema in the clustered read.

**Added** (≈290):
- Axioms in DL notation (⊑, ⊓, ⊔, ∃, ∀, ≡) for display, rendered from the ontology quads (≈70).
- Manchester syntax (W3C Note) as the source pane's text form, through the same line and selection machinery (≈80).
- The subsumption hierarchy and restrictions drawn by extending the class browser and the ontology read: restriction nodes and union domain and range edges, not a new mode (≈80).
- A failed attenuation or boundary check shown as the subsumption that doesn't hold (`c4 ⋢ c1`) with its witness `("action" "Graph:write")` and the `r:Proof` (≈60).
- Rules shown in N3, their own syntax.

## 6. Open questions

- Whether waypoint proofs that interleave, as several callers' proofs do now at each effect, can share one EYE runtime. EYE keeps its closure in global state. The trial ran one proof at a time; stage 2 assumes a queue.
- EYE's OWL coverage beyond RL. The trial didn't find a haibun need for reasoning by case over unions, or from existentials or cardinalities. If one appears, Konclude in a worker, with cross-origin isolation stated as its reason.
- Bytes: if a page ever evaluates containment locally, EYE adds swipl-wasm (about 2.0 MB gz) and `eye.qlf` (69 KB gz) to that page, and the bundle budget would need that much room. Stage 4 avoids this by sending the query to the instance.
- Not checked: Konclude in a browser worker, and EYE in a browser worker or PWA. haibun already loads swipl-wasm the same way in both, but that wasn't run here. The Konclude documentation site, and a rebuild of its wasm, weren't attempted.

## Addendum: class expressions in steps, and `never`
- Rename haibun's `not` step to `didn't {statements}` (operator's choice, replacing `never`). Same meaning: holds when its statement doesn't succeed (closed world, actuality). Its products (`refusal`, seqPath) stay. Migrate every `not` line, the docs and the descriptions; the old name doesn't remain as an alias.
- A `class expression` parameter domain takes a Manchester expression in the fragment that RL evaluates completely for queries: named classes, `and`, `or` (parentheses required when mixed with `and`), `some`, `value`, `{individual}`, `inverse`, datatype facets. Refuse `only`, `not`, `min`, `max` and `exactly` inside expressions, naming the construct and the reason. Check names against the ontology (suggest the nearest), and each property against its domain and range (suggest `inverse`).
- Steps: `individuals of {expression}`, `subclasses of {expression}`, `superclasses of {expression}`, each a declared list so the combinators apply. A single individual's membership is three-valued in the products (member, not member, unknown).
- Records are queried by class expressions through the reasoner; `whose` and `matching` remain for lists that aren't records. Graph reads' own filters go.
- Safety checks are phrased positively (prove containment) so they fail closed; a rule test flags `exactly 0` over class expressions in authority checks.
- Composing: the step input completes names and keywords from the ontology, offering only the properties that apply, and shows a plain-English reading of the expression as it is typed (generated, as OWL verbalizers do). Results are labelled as entailed members (others may exist). The DL view shows the same syntax.
