# Logic in Haibun: Claims, Rules, and Derived Answers

This document describes a plan to add a reasoner to haibun and a surface for stating logical claims and rules in feature prose. The reasoner derives answers from those claims and reports the chain of reasoning behind each answer. The framing is First-Order Logic; the closer ancestor for the typed-data side is the Description Logic family that underlies RDF Schema, OWL, and JSON-LD's `@context`.

The reasoner takes input from two streams: typed-data documents (like JSON-LD, whose triples enter as facts), and the step prose that authors write in feature files. The same prose declares predicates and rules, asserts facts, requests proofs, and reads answers back.

A working application has three artefacts that ordinarily live apart: a specification, an implementation, and a test suite. The lines in a logical description serve all three. The lines that state what holds are the lines the reasoner checks for truth. The reasoner that runs the application is the same one that derives its conclusions. Instructions a person can follow to use the system, an explanation of why a particular result occurred, and the criterion the tests check against all read from the same description.

Outside-world steps — network calls, signing, storage, user-agent interaction — stay imperative. Their results enter the reasoner as facts whose predicate they declare. The boundary between imperative action and logical derivation is explicit.

## Vocabulary

First-Order Logic has a vocabulary; haibun has another for some of the same things. Where the two diverge, haibun's term is preferred below.

An **individual** is a particular thing the system reasons about. It is referred to by a reference: a URI, a DID, a vertex id, a JSON-LD `@id`. The system does not handle a thing directly; it handles a reference and what someone has recorded under it. Two parties may refer to the same individual under different references. Equality between individuals is equality between what their references resolve to, not byte-level identity.

A **domain** (FOL: *sort*) is a named category. `set of meal is ["dinner", "lunch", "breakfast"]` declares one. A reference is read under a domain to fix which facets the rules speak about. The domain does not claim to capture the referent in full; it declares the properties, relationships, and states the rules attend to.

A **predicate** is a named relationship with typed parts. `signed_by(VerifiableCredential, Issuer)` has two parts; `Ready(Meal)` has one. Each part has a declared domain that says what kind of individual can go there. Predicate names are themselves references — IRIs in JSON-LD, declared names in haibun that map to IRIs. A predicate becomes a **fact** when its parts are specific individuals: `signed_by(credential-7, did:web:tethys.osf)`. A fact is a triple of references — subject, predicate, object — each of which can be looked up.

A **variable** stands for any individual: `x`, `y`. In haibun a variable is a step placeholder `{x}`. Variables allow a single statement to speak about every individual without naming each.

The set of asserted facts is the **ABox** (assertion box, from Description Logic). In haibun it is the working memory stored in `FACT_GRAPH`.

The declared vocabulary — domains, predicates, rules — is the **TBox** (terminological box) or *signature*. Haibun has no native term for the whole TBox; the closest published form is the `ConcernCatalog` returned by `step.list`.

A **rule** has a head and a body. The body's facts together let the head be derived: `Ready(m) ← Cooked(m) ∧ Plated(m)`. In haibun, a rule is a `waypoint` with a goal-shaped proof inside an `Activity:` block.

Inference happens in two directions. **Backward chaining** starts from a goal and searches the rules for facts that support it, binding variables along the way. **Forward chaining** starts from facts and rules and derives every new fact those entail. The substitution that makes a rule's head match a goal is a **unifier**.

The result of a successful inference is a **proof tree**: the goal at the root, the rule applied at each interior node, the unifier at that node, the supporting facts at the leaves. A failed inference returns a partial tree pointing at the first sub-goal that could not be proved.

## Haibun steps

A step in haibun is a single line in a feature file that matches a gwta pattern. Every step evaluates to true or false: success returns `OK`, failure returns `actionNotOK`. A scenario passes if every step in it is true.

Steps carry several logical roles depending on what the line is:

| Step                                        | Role                                            |
| ------------------------------------------- | ----------------------------------------------- |
| `assert dinner is "ready"`                  | fact assertion                                  |
| `dinner is "ready"`, `fact …`               | fact query                                      |
| `ensure …`, `resolve …`                     | goal-directed proof search                      |
| `every {x} in D is …`, `some {x} in D is …` | quantification                                  |
| `not …`, `where …`, `any of …`              | connective                                      |
| navigate, sign, fetch, ingest, click        | outside-world action; facts arrive as a result  |
| capital-letter sentence ending in `.`       | narrative prose, dispatched as a no-op          |

A query step's truth value is whether the fact holds. An `ensure` step's truth value is whether the goal is provable. A `not` step's truth value is the inverse of its inner result. Every step receives a `seqPath`; every fact a step asserts carries that `seqPath` as provenance.

Working memory is populated from more than authored steps. Triples can be read in bulk from typed-data sources: a JSON-LD document under the predicates its `@context` declares, a hypermedia response under predicates that name its links and attributes, an HTTP observation stream as one triple per request. The dispatcher's existing `productsDomain` auto-assertion is the same channel applied to a step's own output. All resulting triples live in `FACT_GRAPH` and are queryable by any rule.

## The signature in feature prose

A domain is declared with `set of D is [values]`, `ordered set of D is [values]`, or `set of D as superdomain is [values]`. The first lists allowed values; the second adds an order for comparison; the third subordinates one domain to another.

A predicate is declared with `predicate {pattern}`:

```
predicate {x:meal} is {state:meal-state}
predicate {issuer:Issuer} delegates to {p:Person} for {a:Action} at {v:Venue}
```

The verb in a using line decides assert versus query. `assert dinner is "ready"` writes the fact. The bare `dinner is "ready"` queries it.

A rule is a parameterised waypoint with a goal-shaped proof:

```
Activity: Get a meal ready
waypoint {m:meal} is "ready" with {m} is "cooked" and {m} is "plated"
```

Read as logic this is `Ready(m) ← Cooked(m) ∧ Plated(m)` for any `m` of domain `meal`. The activity body is run by the reasoner when the proof fails: its steps extend working memory until the proof can be re-checked.

A universal as a rule is declared with `for every {x:D} where {body}, {head}`:

```
for every {x:meal} where {x} is "cooked", assert {x} is "edible"
```

The reasoner adds an `edible` fact whenever a matching `cooked` fact is asserted, and uses the same rule to answer `edible` goals by looking for the matching `cooked` fact.

## Facts about individuals

Facts are stored as triples in `FACT_GRAPH`. The subject is the individual the fact is about. The predicate is the relation. The object is the value or related individual.

```
assert dinner is "ready"
assert dinner contains "tomato"
fact dinner is "ready"
not fact dinner is "raw"
```

Each fact carries its provenance as a quad property: the `seqPath` of the step that asserted it, the rule (if any) whose firing derived it, the parent goal (if any) that prompted that derivation. A proof tree is reconstructable from working memory.

## Goals and proofs

A goal is a predicate application possibly containing variables: `Ready(dinner)`, `Ready(x)`, `Owns(alice, ?)`.

```
ensure dinner is "ready"
resolve "dinner is ready"
some {x:meal} is "ready"
every {x:meal} where {x} is "cooked", {x} is "edible"
```

`ensure` is backward chaining combined with the option of running an activity body to make a failed proof succeed on retry. `resolve` is backward chaining as a query and returns a tree. `some` and `every` quantify, either as bounded iteration or — when the head is a fact-shaped statement — as a rule the reasoner uses in both directions.

A proof tree renders as:

```
is(dinner, ready)
├── rule: is(m, ready) ← is(m, cooked) ∧ is(m, plated)   [m ↦ dinner]
│   ├── is(dinner, cooked)   fact at seq 0.1.2.3
│   └── is(dinner, plated)   asserted by activity body at seq 0.1.4.1
```

The monitor renders the same tree. An RPC `derive "{goal}"` returns it.

## The hypermedia surface

`step.list` returns the registered steppers and a `ConcernCatalog`. The catalog includes a `predicates` section listing each declared predicate by name, the domain of each part, and a sample step. The SPA's affordances panel uses the catalog to render predicates as advertised next moves. An MCP client uses it as a tool inventory. An LLM caller binds to it as typed tool definitions.

`signature.list` returns the full signature: domains, predicates, rules, functions. `derive "{goal}"` returns a proof tree or a partial tree pointing at the unprovable sub-goal.

## Negation, equality, functions

`not {statement}` is negation as failure: if the statement fails to prove, the negation succeeds.

`absent {statement}` is the closed-world counterpart: an authored assertion that the statement is known to be false. Used where "we have no proof" must be distinguished from "we have a proof of falsity".

`{a} is the same as {b}` declares equality between two individuals; the reasoner treats them as one. A DID alias whose two strings resolve to the same key is the common case.

A function declaration `function {name}({parts}) → D` registers a domain-typed projection. Functions are evaluated during proof search and their results substitute for the application. A function is sugar over a predicate whose final part is the result.

## Surface syntax

`✓` marks a step that exists in haibun. The unmarked lines are added by the phases below.

```
✓ set of D is [values]
✓ ordered set of D is [values]
✓ set of D as superdomain is [values]

  predicate {pattern}

  assert {subject} {predicate} {value}
  {subject} {predicate} {value}                       (query form)
✓ not {statement}
  absent {statement}
  {a} is the same as {b}

✓ Activity: name
✓ waypoint {head} with {body conjuncts}
  for every {x:D} where {body}, {head}                 (rule form)
✓ ensure {goal}                                        (one-hop; chained after phase 3)
✓ resolve "{goal}"                                     (atomic; unifying after phase 2)
  derive "{goal}"

✓ some {x} in D is {statement}
✓ every {x} in D is {statement}
✓ where {condition}, {action}
✓ whenever {condition}, {action}
✓ any of "A, B, C"
✓ maybe {statement}

✓ show affordances
✓ show chain lint
  show derivation of "{statement}"

✓ step.list                                            (returns steppers + ConcernCatalog)
  signature.list                                       (returns domains + predicates + rules)
```

Every line follows haibun's step format. No additional bracket convention or tooling is required.

## Phases

The system is delivered in phases. Each phase keeps the surface authored before it functional.

### Phase 0 — Per-subject facts

Two steps for direct ABox assertion and query:

```
assert {subject:string} {predicate:string} {value:string}
fact {subject:string} {predicate:string} {value:string}
```

The first writes a `(subject, predicate, value)` quad into `FACT_GRAPH`. The second succeeds if the quad exists. Provenance — the asserting `seqPath` — is a property on the quad. Later phases read and write here.

### Phase 1 — Predicates as first-class declarations

A declarative line registers a predicate with named, domain-typed parts:

```
predicate {subject:meal} is {state:meal-state}
```

The parser builds a predicate descriptor `(name, arg-domains)`. The verb in a using line decides assert versus query. `step.list`'s catalog gains a `predicates` section.

### Phase 2 — Unification in the resolver

Goals and rule heads become predicate applications possibly containing variables. The resolver finds a most-general unifier between goal and head; the unifier propagates through the body's conjuncts.

`ensure dinner is "ready"` finds the rule `{m} is "ready" with …` by binding `m ↦ dinner`. The body's `{m}` references resolve to `dinner`.

### Phase 3 — Rule chaining

`ensure`'s proof check re-solves goal-shaped proofs recursively. A predicate application that matches another rule's head triggers a sub-derivation. Recursion is bounded by a depth limit and a cycle guard.

### Phase 4 — Proof objects

Every successful `ensure` and `resolve` returns a proof tree. Failures return a partial tree marking the first unprovable sub-goal. The monitor renders trees. The affordances panel surfaces a `show derivation` action per reachable goal. The RPC surface exposes `derive` for external callers.

### Phase 5 — Universals as rules

`for every {x} where {x} is "raw", {x} is "uncooked"` registers the rule `Uncooked(x) ← Raw(x)`. The forward chainer runs on each new `raw` fact and adds the corresponding `uncooked` fact. The backward chainer uses the rule to prove `uncooked` goals from `raw` facts.

### Phase 6 — Equality and classical negation

`{a} is the same as {b}` registers equality with congruence; queries normalise to canonical representatives. `absent {statement}` adds a closed-world falsity assertion separate from negation as failure.

### Phase 7 — Functions

`function {name}({args}) → D` registers a domain-typed projection. Function applications evaluate during proof search.

## Worked example: cooking

```
set of meal is ["dinner", "lunch", "breakfast"]
set of meal-state is ["raw", "cooked", "plated", "ready"]
predicate {m:meal} is {s:meal-state}

Activity: Get a meal ready
waypoint {m:meal} is "ready" with {m} is "cooked" and {m} is "plated"

assert dinner is "cooked"
ensure dinner is "ready"
fact dinner is "ready"
```

`is(dinner, ready)` unifies with the waypoint head, binding `m ↦ dinner`. The sub-goal `is(dinner, cooked)` is in working memory. The sub-goal `is(dinner, plated)` is not, and no rule head matches; the activity body runs and asserts it. Re-check passes.

```
is(dinner, ready)
├── rule: is(m, ready) ← is(m, cooked) ∧ is(m, plated)   [m ↦ dinner]
│   ├── is(dinner, cooked)   fact at seq 0.1.2.3
│   └── is(dinner, plated)   asserted by activity body at seq 0.1.4.1
```

## Worked example: credentials

```
predicate {c:VerifiableCredential} is signed by {i:Issuer}
predicate {i:Issuer} controls {k:VerificationMethod}
predicate {c:VerifiableCredential} is valid

Activity: Validate a credential
waypoint {c:VerifiableCredential} is valid with {c} is signed by {i} and {i} controls {k} and the signature of {c} verifies under {k}

ensure credential is valid
```

If validation fails, the partial tree names the unmet conjunct, for example "the signature did not verify under did:web:tethys.osf#key-1".

## Worked example: capability delegation

```
predicate {p:Person} may {a:Action} at {v:Venue}
predicate {i:Issuer} delegates to {p:Person} for {a:Action} at {v:Venue}
predicate {p:Person} holds a capability granted by {i:Issuer}

Activity: Authorize at a venue
waypoint {p:Person} may {a:Action} at {v:Venue} with {p} holds a capability granted by {i} and {i} delegates to {p} for {a} at {v}

ensure "child" may "swim" at "pool"
```

The reasoner walks the delegation chain backward. The chain is the tree.

## Worked example: observation + rule

```
for every {req} observed in http-trace where {req}/status is more than 399, assert {req} is "broken"

for every {req} where {req} is "broken", assert pipeline is "degraded"

ensure pipeline is "healthy"
```

Runtime observations become facts. Facts trigger rules that derive further facts. The pipeline goal's answer reflects the cumulative state.

## Scope

Steppers act on the world. The reasoner reasons about goals, rules, and facts. The two are separate.

Inference uses goal-directed backward search through the rule set. The surface is haibun feature prose.

Finite domains, depth limits, and cycle guards bound proof search.

The system targets multi-step plans, capability checks, declarative validation, and entailment from runtime observations. Deterministic one-shot flows continue to be written as plain step sequences.

## Open questions

How a predicate's per-subject key is derived from a `productsDomain` payload — fall back to `seqPath` when no `idField` is declared.

How higher-arity predicates store in a quad store — reify into anonymous individuals carrying the tuple, with the relation as type.

Where the reasoner runs — in-process per feature first, with a `derive` RPC for clients; an out-of-process inference service later if needed.

Whether `signature.list` and `derive` belong on the existing `step.list` RPC surface or a new namespace.

How existing `productsDomain` declarations migrate — auto-derive a one-part predicate per declaration; let authors opt into richer signatures over time.

## Summary

A signature: domains, predicates, rules. A working memory of per-subject facts. A reasoner that runs in both directions. Proof trees that record why each answer holds. A hypermedia surface that publishes the signature to every client. All written in haibun's step prose.
