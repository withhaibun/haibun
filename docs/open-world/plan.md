# Open-world logic: staged plan

Status is kept in the checklist at the end. Each stage ends with haibun's suites green, a signed commit, a push, and the checklist updated in this file in the same commit. A restarted session resumes at the first unchecked stage. The detailed findings (closed-world inventory, trial measurements, licences) are in the design notes beside this file (design-notes.md). This plan states each finding that determines a stage.

## Process
- Resume at the first unticked stage in the checklist, on branch `delegated-action`.
- AGENTS.md and docs/architecture.md govern code and prose. The repository's rules test (scripts/rules.test.ts) holds them, and its baselines only shrink.
- Suites: `npm run build`, `npm run lint`, `PLAYWRIGHT_BROWSERS_PATH=/tmp/claude-0/pw-browsers npx vitest run`, and `HAIBUN_O_WEBPLAYWRIGHT_HEADLESS=true npm run test:e2e` with the same browser path.
- Commits are signed (`git commit -S`) and use bullet-grouped messages without attribution lines. Hooks always run. Each commit includes the `actualities.json` changes its suites wrote. Push to origin `delegated-action`.
- Applications built on haibun keep their own plans for their part of the change, in their own repositories, and run their suites against each stage before it is pushed.
- An application reads haibun as an ordinary dependency: each package's build and `.d.ts`, linked from its `node_modules`. haibun builds (`npm run build`, or `build:watch` running) before an application uses a change, and the application compiles each of its projects with `tsc -p`, which checks again where a changed `.d.ts` changes the project, since `tsc -b` compares only the project's own inputs with its build info.
- Each stage ticks its checklist line in this file in the same commit. Beneath the line it records the net source lines, the steps removed and the feature lines whose meaning changed. A question that needs an operator decision is recorded there too.
- The N3 rules from the trial that the stages reuse are in `trial/` beside this file.

## Intent
haibun is a readable, declarative language over hypermedia and RDF, open world, based on description logic, with few patterns, without special cases, and on standards only. It runs for years and offline (Node, browser, worker, PWA), as pglite does.

## Model
- Actuality is knowledge too. Everything recorded is RDF. The only difference is which graphs are complete.
- A graph declared complete is closed over its own contents: actuality's graph (complete by construction), a Trusted List for its entries, a revocation list for its revocations. Closure is declared once per graph, never chosen step by step. The standard mechanism is N3 scoped negation (`log:notIncludes`) over that named graph; documentation names it so.
- Every other graph is open: an unproved claim is `unknown`, and a gate refuses on `unknown` (fails closed) without asserting a falsehood.
- Standards: OWL 2 at the RL profile for knowledge; N3 rules run by EYE; ODRL meaning for ZCAP capabilities through alignment axioms (zcap:invocationTarget ≡ odrl:target, allowedAction ≡ odrl:action, controller ≡ odrl:assignee, parent's controller = odrl:assigner, expires and caveats = odrl:constraint; permissions and constraints only, without prohibitions or duties). ZCAP-LD is a CCG draft, ODRL 2.2 a Recommendation, N3 a Community Group spec.

## Language: one language, layers with one job each
1. Claims state what holds, proved by the reasoner. Each form is one formal construct:
   - `individual {name} is a {expression}`: membership (a ∈ C), like Manchester `Individual: … Types:`.
   - `every {expression} is a {expression}`: subsumption (C ⊑ D). Containment, attenuation and boundary checks, stated positively, failing closed with the witness that exceeds.
   - `some {expression}`: existence.
   - Knowledge doesn't have a form for "none": the open world can't prove absence; "none" is a disjointness in the ontology.
2. Actions do things. Code steps stay general primitives. Their results are typed individuals in actuality's graph (a refusal is a `Refusal` with `lacksAction`, etc.), named with `set {name} from …`, so claims refer to them.
3. Waypoints compose claims and actions as N3 rules, in `@haibun/<module>/waypoints`. Domain sentences ("the list is recognized for its entries") are waypoints expanding to claims.
4. Combinators (matching, counting, limited to, ordered by, skipping, since, before, exactly, at least, whose, as of, for each) page, order and count lists for reading. They aren't logic.
- haibun's `not` step is renamed `didn't {statements}` (same meaning: the statement didn't succeed; closed world over actuality's graph; products keep `refusal` and seqPath). The old name doesn't remain as an alias.
- Expected errors become claims about typed refusals, replacing `set … from didn't …` plus `matches ….refusal with "…"` where the refusal is typed.

## Expression vocabulary (inside claims only)
- The `class expression` parameter domain takes Manchester syntax in the fragment that OWL 2 RL evaluates completely for queries: named classes, `and`, `or` (parentheses required when mixed with `and`), `some`, `value`, `inverse`, datatype facets.
- Refused, each naming the construct, the reason and the alternative: `only`, `not` (complement), `min`, `max`, `exactly`, and braces (`{c2}` clashes with haibun interpolation; use `individual c2 is a …` or `value c2`).
- Names come from the ontology and are checked (nearest suggested); each property is checked against its domain and range (`inverse` suggested). Ontology names are short and verb-like (`recognizedFor`, `grantedTo`, `lacksAction`).
- Records are filtered by class expressions; `whose` and `matching` remain for lists that aren't records. Graph reads' own filters go.

## Leading users to formal logic, without nonsense
- Levels, one link apart: waypoint sentence → claims → DL formula plus proof or witness → ontology terms in the DL view.
- Refusals teach the rule they enforce (OWL 2 RL doesn't evaluate `only`; `unknown` isn't false in the open world: add the fact or use a complete graph).
- Results use standard terms only: entailed, not entailed, unknown, contradicts, subsumed, witness.
- The step input completes names and keywords from the ontology (only applicable properties) and shows a plain-English reading generated by fixed rules, beside the DL form, never replacing it.
- Safety checks are positive; a rule test flags `exactly 0` and other absence checks over class expressions in authority checks.

## Reasoner
- EYE (MIT) on the swipl-wasm 8.2.3 runtime haibun already ships (BSD-2). `eye.qlf` (202 KB, 69 KB gzipped) is promoted from a test fixture to a runtime asset, loaded on first use. Don't use the npm `eyereasoner` package (it pins a second swipl-wasm and a conflicting n3).
- It runs single-threaded, without SharedArrayBuffer or special headers. It reads haibun's IQuadStore through the existing read effect. A second store (such as Oxigraph) isn't added.
- EYE keeps global state: one query at a time per runtime; queue proofs. Measure under the service's real load before the Prolog path is removed. User built-ins need an `engine_self` guard (they run during scoped negation). `log:forAllIn` tries to start a subprocess in wasm: use the negated counterexample instead.
- Pages send containment queries to the instance; they don't evaluate containment themselves (it would add about 2 MB gzipped).
- Konclude (LGPL, needs threads, so cross-origin isolation) is reserved for full OWL 2 DL only if a need appears; that need would be its stated reason under the workaround rule.

## DL view
- Replaces TPTP: removes `show graph {view} as tptp`, logic `derivations/formula.ts` and `derivations/term-graph.ts`, the TPTP faces of `derivations/registry.ts` and `pipelines/registry-reads.ts`, `producerAxioms`, the projection schemas, the `rule` step, Shu's TPTP source format and the "source terms" view (about −840 source, −238 tests).
- Adds DL notation (⊑, ∃, ⊓) for display, Manchester syntax as the text in the source pane, individuals as frames, restrictions and union domains drawn in the existing class browser and ontology read, failed checks as the subsumption that doesn't hold with its witness, rules in N3 (about +290).
- A DL query box: a class expression returns entailed members, labelled as entailed (others may exist), as ref links; combinators apply.

## Fixes found by the trial
- The ontology export lists every type declaring a relation as its domain; in OWL several domain axioms mean intersection, so export them as `owl:unionOf`. A class's declared `@type` IRI is its superclass (several classes share one IRI).
- `not` (renamed `didn't`) of an `unknown` is `unknown`.

## Glossary
Approved by the operator; stage 7 applies the renames as part of its rewrite. Each term has one meaning in haibun, and the standard's term is used where one exists.
- **waypoint**: a named outcome in readable domain prose, its head, that a feature or a person states. Its proof proves it, evaluated as an N3 backward rule over claims from stage 7; its activity establishes it where the proof doesn't hold. A module publishes its waypoints in its `waypoints` library, and the step input offers them. The head, the activity, `ensure`'s check and establish, the library and the waypoint's record in actuality stay haibun's.
- **goal**: what `ensure {goal}` holds: a waypoint's head, stated as a statement, or a domain goal, stated as a quoted domain key (automated planning's goal). A domain goal holds by a fact of its domain, a product of a step, and producer rules state the steps that return it.
- **producer rule**: a step's signature read as a rule: a fact of the domain it returns holds where facts of the domains it takes hold and the step is performed (STRIPS: an action's preconditions and effect). Separate from a waypoint.
- **ensure {goal}**: proves the goal, and where it doesn't hold, establishes it: a waypoint's activity, or a domain goal's plan, then proves it again. `pursue` is removed into it.
- **plan {goal}** (was `walk toward`): writes a plan record, the steps that would make a domain goal hold, naming the next step (PDDL's plan). `planOf` and `TPlan` already mean this. Other uses of the word: `queryExplain` (was `queryPlan`, a SQL query plan) and `TProposedTurn` (was `TPlannedTurn`, a model's proposed lines) are renamed; this file and the application's `docs/planning/` are project plans, which are prose.
- **advance plan {plan} with {args}** (was `advance the walk`): performs a plan's next step with the values a person supplies. The domains are `plan-id` and `plan-progress`, the graph `PLAN_GRAPH`, and the type `TPlanProgress`.
- **applicable steps** (was "affordances on offer"): the steps the caller may call whose inputs the facts hold (automated planning's applicable actions); `show applicable steps`, domain `applicable-steps`.
- **claim**: a statement the reasoner proves over the ontology and the records, open world: `individual … is a …`, `every … is a …`, `some …`. One the records don't prove is unknown.
- **containment**: a permission's place within its bound, as ODRL 2.2 reads a ZCAP-LD capability: each action, the target and the expiry within the bound's. Its witness is what exceeds.
- **urakata**: a background task the instance runs (Japanese: the crew behind the stage).
- **kireji**: the builder that writes features as code (Japanese: the cutting word of a haiku).
- **taiwa**: a conversation between people and a model, as an actuality (Japanese: dialogue).
- **shu**: haibun's page: the hypermedia app that shows an actuality and calls its steps.

## Stages
Both engines run side by side on the same runtime until stage 7 removes the Prolog knowledge path. Stage 5 is an application's, and its plan holds it. Each stage reports steps and special cases removed, net source lines, and the feature lines whose meaning changed.

1. OWL export corrected (union domains, superclass IRIs); EYE runtime loaded on first use behind the existing effect protocol, with the proof queue; actuality's graph declared complete; any type's graph declarable as complete.
2. DL view and DL query box; TPTP removed. Validates the export against a real view early.
3. Claim forms and the class-expression domain with refusals, name and direction checks, completion and plain-English reading; rule test for positive safety checks.
4. Typed refusals in the ontology; `not` renamed `didn't` everywhere (37 lines plus docs); expected errors moved to claims where the refusal is typed.
6. Capabilities and delegation as ODRL claims (attenuation, boundary containment, `holding capability`, `capabilityAllows`), then the remaining knowledge lines (about 70) and knowledge sites (8) moved to claims. Graph reads' own filters replaced by class expressions.
7. Waypoints' proofs as N3 rules, one library at a time (core, logic, shu), and domain goals over producer rules as N3 rules, with sites #9, #10, #11 and #14; then the Prolog knowledge path removed (goals, waypoint proofs, falsity, sameAs, chain lint), `haibun.pl` reduced to the closed proof of a line (about 341 → 150 lines), `fol-in-haibun.md` removed; docs and architecture.md updated. A waypoint's declaration gains a description its type requires, as a step's and a domain's do, so a reader and the step input show what each waypoint establishes.
Estimated total: about −1,300 / +880 source lines.

## Later
- An edge's range is checked at write only when a range can be read with its subclasses. Today a write checks that the source type declares the edge, or that the shared vocabulary holds it; a range names a superclass such as Resource, so checking the target's type against it needs the ontology's subclass axioms, which the write path doesn't read yet.
- A consumer's features may link a person's record through a Principal's `author` edge, which the shared vocabulary admits. A Person-to-Principal relation, such as `foaf:account`, would state it precisely; it needs a link relation of its own, which waits for the next change to the consumer's person type.
- W3C Solid and the fediverse (ActivityPub) matter later, as standards, and the model stays compatible with them without adopting either now: records stay RDF with JSON-LD contexts, and the topology stays describable declaratively, for example as Shape Trees for Solid pods.

## Checklist
- [x] 1 OWL export and EYE runtime
  - Net source lines: +374 (core +79, logic +295). Tests: +129. Steps removed: 0. Special cases removed: 0. Feature lines whose meaning changed: none.
  - `records/derivations/owl.ts` derives the ontology as OWL 2 in Turtle: the classes that declare a property are its domain as one `owl:unionOf`, and the same for its range; a class's declared `@type` IRI is its superclass; every CURIE expands through the served `@context`. The Property records relate classes through `schema:domainIncludes` and `schema:rangeIncludes`, which state a union.
  - A topology declares its graph complete with `complete: true`, and the steps' graph (SeqPath) declares it. The `reason` pipeline states each complete graph its rules close over as one formula, `<class> h:complete { … }`, and refuses to close over a graph that isn't declared complete. An application declares its own complete graphs where its rules read them.
  - EYE moved from a test fixture to `@haibun/logic/eye.qlf`, loaded on the first session. The `h:read` built-in yields the existing read effect. Sessions run one at a time in order. EYE's `main` leaves its facts, rules and tables in the runtime, so each session starts a runtime of its own (about 100 ms).
  - Decided by the operator, in a follow-up commit: the served `@context` names each type's class `hbn:<label>`, maps the type's term to it, and states the declared `@type` IRI and the declared superclasses on that class node, so classes that declare one IRI keep their own axioms and a record's `@type` expands to its own class.
  - Decided by the operator, in the same commit: a complete graph is complete only to a reader at or above its type's access level, the narrowest level that holds its records. For a reader below that level the graph is open, so the `reason` pipeline doesn't state it as a formula, and a claim its records don't prove stays `unknown`. Tests cover both sides.
  - Decided by the operator, in the same commit: the downstream-names rule matches application and organization names only, and its baseline counts those mentions. haibun's prose calls its authority model ZCAPs (capabilities and delegations).
- [x] 2 DL view, TPTP removed
  - Net source lines: −517 (+586, −1,103). Tests: −347. Feature lines: −32. Steps removed: `rule {formula}` and `show graph {view} as tptp`. Steps added: `show axioms of {view}`, which takes the source pane's place, and `individuals of {expression}`. Special cases removed: the source-terms view choice, hollow chips, cluster badges and the scene styles a projection requested.
  - Removed: logic `derivations/formula.ts`, `derivations/term-graph.ts`, `domains/tokens.ts`, the TPTP faces of `derivations/registry.ts` and `pipelines/registry-reads.ts`, `producerAxioms` and `goalConjecture`, the formula domain, the projection schemas and the rule schema; the record arities of core's predicate registry; shu `derivations/graph-formulas.ts`, `page/graph/derivations/term-scene.ts`, and the graph view's goal, which only the TPTP conjecture read.
  - Added: core `records/domains/axioms.ts` and `records/derivations/axioms.ts` (Manchester syntax and DL notation of a class, a property and an individual); the ontology read states each term's axioms in DL notation; shu `derivations/graph-axioms.ts` returns the axioms of what a graph view shows as frames, which the source pane shows as Manchester text with the DL notation on hover; logic `derivations/class-expression.ts` and `pipelines/members.ts` read a class expression (named classes, `and`, `or`, `some`, `value`) and return the members the reasoner entails. The query box is the step input running `individuals of`, whose members are a counted list, so the combinators apply.
  - Feature lines whose meaning changed: requirements 13 "Formula notation" became "Conjunctions"; its three scenarios of the `rule` step are removed. shu's views waypoint "graph {view} draws the terms of its source" became "graph {view} shows its axioms beside the scene". New lines: the monitor feature reads the ontology's DL notation, `individuals of`, and `show axioms of …`; requirements 07 counts the members `individuals of` returns.
  - An application's feature drives the source pane in a browser through haibun's views waypoints.
  - Renamed at the operator's request, in a follow-up commit: the step is `show axioms of {view}`, its domain `graph-axioms`, and the source pane, the views waypoint and the docs read axioms, in DL notation with Manchester syntax as their text form.
- [x] 3 Claim forms and expressions
  - First part, net source lines: +215. Tests: +69. Feature lines: +34. Steps removed: 0. Steps added: 0.
  - The class expression domain refuses `only`, `not`, `min`, `max`, `exactly` and braces, each naming the construct, its reason and the form to write; it reads `inverse {property}`; it checks each class and property against the ontology and suggests the nearest name, and suggests `inverse` where a restriction reads against its property's direction. A domain may state a reading of a term, and validating a line returns each reading: a class expression reads in DL notation and in plain English.
  - The resolver lets a domain's refusal settle a line that matches several steps: a step whose domain refuses a term the line writes doesn't take the line.
  - A rule test holds safety checks over class expressions positive: it finds a count of an expression's members held to zero and a negated membership, with an empty baseline.
  - Feature lines whose meaning changed: none. New: requirements 16, Class expressions.
  - Completed after the operator's decisions, net source lines: +121 (+136, −15). Tests: +29. Feature lines: +21. Steps removed: 0. Steps added: 3, which the operator approved, so the step count's baseline is 221.
  - Decided by the operator on question 3: (c), the three claim steps are added. `individual {address} is a {expression}` holds a membership, `every {expression} is a {expression}` a subsumption the ontology entails, with the members that exceed it as the witness where it doesn't, and `some {expression}` an existence, returning the members. Each fails closed: a claim the records don't prove is unknown, which isn't false. `individuals of` stays as the query.
  - Decided by the operator on question 4: the page's bundle doesn't grow. The instance returns the reading and the completions through `validate step`: a domain may state the completions of a term it refuses, and the class expression domain offers each class or property name that begins with the expression's last word.
  - Feature lines whose meaning changed: none. New: requirements 16 states the three claims and a completion; shu's monitor feature states a membership, an existence and a subsumption through a class's declared IRI.
- [x] 4 Typed refusals and `didn't`
  - Net source lines: +49 (+86, −37). Tests: +50. Feature lines changed: 48 here and 51 in the application's features, each a renamed line or a moved claim. Steps removed: 0. Steps added: 0. Special cases removed: the in-memory holding of the products of steps.
  - `not` is `didn't {statements}` everywhere: the step, its reading, every feature line in both repositories, the executable AGENTS.md, the tests and the docs. The engine's functor stays `not`. The old name doesn't remain.
  - A refusal is typed: where the gate refused a call for an action its caller doesn't hold, the refusal carries `lacksAction`, and a node carries the remedy of the part that determined its verdict. Two expected errors moved from matching the refusal's text to the typed claim `variable … .lacksAction is …`; an untyped refusal keeps its text.
  - The products of steps are records of their type held where the steps' records are, retained as instrumentation, and linked to their step by a reference edge, which a caller without a read action writes. A proof of goals reads them as records rather than as quads, so a store that refuses a quad read without a subject holds them (review LR1).
  - A list of statements is read by one reader, which a comma inside a quoted or backticked term or a JSON value doesn't split (review LD4).
  - Feature lines whose meaning changed: none. `didn't` states what `not` stated.
- [ ] 6 Capabilities and knowledge lines
  - First part, capabilities. Decided by the operator: option A. The reasoner proves containment where authority is set: a statement under a presented capability, a narrowed statement, and an application's delegation and grant. The synchronous gate keeps its check (`capabilityAllows` in `lackedByCall`, `mayCall`, `readCeilingOf` and `mayWriteAt`), and a test runs the same cases through both and requires the same verdict.
  - logic `derivations/containment.ts` states ODRL 2.2's reading of a ZCAP-LD capability: the alignment axioms (`sec:invocationTarget` is `odrl:target`, `sec:allowedAction` is `odrl:action`, `sec:controller` is `odrl:assignee`, the parent's controller is the assigner, `sec:expires` is a constraint on the dateTime), the action grammar with the read levels from core's access order, target containment, and containment with its witness: each action, target and expiry the bound doesn't allow. `pipelines/containment.ts` proves it, and the prover's `exceeding` port returns it to core.
  - `holding capability` refuses a use outside the capability's target or after its expiry, naming the witness. `holding only` holds each listed action its caller's actions contain.
  - Feature lines whose meaning changed: requirements 02's stand-in capabilities state their target. New: requirements 02, "A presented capability covers only its target, until it expires".
  - Second part, the open-world knowledge sites. Decided by the operator: the narrower reading. Goals, affordances, `ensure`, `pursue` and `walk toward` read waypoints' proofs and domain goals, whose reasoning moves to N3 in stage 7, so the goal path is written once.
    - `not` of an unknown statement is unknown (`naf(unknown, unknown)`): a refused call, a goal without a fact and a claim the records don't prove each stay unknown under `didn't`. `maybe`'s products hold its statement's verdict with why it didn't hold, so a feature states an expected refusal through `set … from maybe …` and its `verdict`, `refusal` or `lacksAction`.
    - Every Property states `inData` at derivation, and a read refuses one that doesn't (design notes #18). Decided by the operator: sites #9, #10, #11 and #14 are in the Prolog goal path, so their open-world behaviour is set once, in stage 7's N3 rewrite of the goal path; the change to them made here was taken back.
    - The claims `individual … is a …`, `every … is a …` and `some …` end unknown where the records don't prove them, as they stated.
    - Feature lines whose result moved from refuted to unknown: requirements 16 `every SeqPath is a Comment`; requirements 03 `ensure Supper is served` and `ensure It is set`. Lines that negated an unknown statement and now state it through `maybe`: capability identity-and-capability 26, requirements 02 (four lines), requirements 14 15, tests recurse.feature, and in the application, seven lines over refused calls.
    - Knowledge lines: the `resolve` and `absent` lines read goals over step products and a waypoint's stated falsity, which are the waypoint mechanism, and a claim over a class doesn't state the same thing, so they stay for stage 7 with `pursue`, `walk toward`, the affordances, `ensure` and `didn't ensure`. The `every` and `some x in D` lines range over declared closed sets and stay closed.
- [ ] 7 Waypoints' proofs and domain goals as N3 rules, Prolog knowledge path removed
