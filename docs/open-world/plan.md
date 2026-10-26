# Open-world logic: staged plan

Status is kept in the checklist at the end. Each stage ends with haibun's suites green, a signed commit, a push, and the checklist updated in this file in the same commit. A restarted session resumes at the first unchecked stage. The detailed findings (closed-world inventory, trial measurements, licences) are in the design notes beside this file (design-notes.md). This plan states each finding that determines a stage.

## Process
- Resume at the first unticked stage in the checklist, on branch `delegated-action`.
- AGENTS.md and docs/architecture.md govern code and prose. The repository's rules test (scripts/rules.test.ts) holds them, and its baselines only shrink.
- Suites: `npm run build`, `npm run lint`, `PLAYWRIGHT_BROWSERS_PATH=/tmp/claude-0/pw-browsers npx vitest run`, and `HAIBUN_O_WEBPLAYWRIGHT_HEADLESS=true npm run test:e2e` with the same browser path.
- Commits are signed (`git commit -S`) and use bullet-grouped messages without attribution lines. Hooks always run. Each commit includes the `actualities.json` changes its suites wrote. Push to origin `delegated-action`.
- Applications built on haibun keep their own plans for their part of the change, in their own repositories, and run their suites against each stage before it is pushed.
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

## Stages
Both engines run side by side on the same runtime until stage 7 removes the Prolog knowledge path. Stage 5 is an application's, and its plan holds it. Each stage reports steps and special cases removed, net source lines, and the feature lines whose meaning changed.

1. OWL export corrected (union domains, superclass IRIs); EYE runtime loaded on first use behind the existing effect protocol, with the proof queue; actuality's graph declared complete; any type's graph declarable as complete.
2. DL view and DL query box; TPTP removed. Validates the export against a real view early.
3. Claim forms and the class-expression domain with refusals, name and direction checks, completion and plain-English reading; rule test for positive safety checks.
4. Typed refusals in the ontology; `not` renamed `didn't` everywhere (37 lines plus docs); expected errors moved to claims where the refusal is typed.
6. Capabilities and delegation as ODRL claims (attenuation, boundary containment, `holding capability`, `capabilityAllows`), then the remaining knowledge lines (about 70) and knowledge sites (8) moved to claims. Graph reads' own filters replaced by class expressions.
7. Waypoints as N3 rules, one library at a time (core, logic, shu); then the Prolog knowledge path removed (goals, waypoint rules, falsity, sameAs, chain lint), `haibun.pl` reduced to the closed proof of a line (about 341 → 150 lines), `fol-in-haibun.md` removed; docs and architecture.md updated.
Estimated total: about −1,300 / +880 source lines.

## Checklist
- [x] 1 OWL export and EYE runtime
  - Net source lines: +374 (core +79, logic +295). Tests: +129. Steps removed: 0. Special cases removed: 0. Feature lines whose meaning changed: none.
  - `records/derivations/owl.ts` derives the ontology as OWL 2 in Turtle: the classes that declare a property are its domain as one `owl:unionOf`, and the same for its range; a class's declared `@type` IRI is its superclass; every CURIE expands through the served `@context`. The Property records relate classes through `schema:domainIncludes` and `schema:rangeIncludes`, which state a union.
  - A topology declares its graph complete with `complete: true`, and the steps' graph (SeqPath) declares it. The `reason` pipeline states each complete graph its rules close over as one formula, `<class> h:complete { … }`, and refuses to close over a graph that isn't declared complete. An application declares its own complete graphs where its rules read them.
  - EYE moved from a test fixture to `@haibun/logic/eye.qlf`, loaded on the first session. The `h:read` built-in yields the existing read effect. Sessions run one at a time in order. EYE's `main` leaves its facts, rules and tables in the runtime, so each session starts a runtime of its own (about 100 ms).
  - Question 1: the served `@context` states each class node in `@graph` at the type's declared `@type` IRI, so the classes that declare one IRI (several declare `prov:Entity`) merge their `rdfs:subClassOf` axioms onto it. The correction names each class node `hbn:<label>` with its `@type` IRI as a superclass, and maps the type's term to `hbn:<label>`, which changes the expansion of a record's `@type`. The OWL export already states it this way; the served `@context` is unchanged until the operator decides.
  - Question 2: a complete graph is read under the caller's access level. A caller that reads below the level of some of the graph's records reads part of the graph, and a closed check over that part can take an unread record as absent. The options are to refuse a closed check where the caller's level is below the type's level, or to read complete graphs at the type's level.
- [ ] 2 DL view, TPTP removed
- [ ] 3 Claim forms and expressions
- [ ] 4 Typed refusals and `didn't`
- [ ] 6 Capabilities and knowledge lines
- [ ] 7 Waypoints as rules, Prolog knowledge path removed
