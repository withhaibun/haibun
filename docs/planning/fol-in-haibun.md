# Logic in Haibun: Claims, Rules, and Derived Facts

This document describes a plan to add a reasoner to haibun and a surface for stating logical claims and rules in feature prose. The reasoner derives conclusions from those claims. It reports the proof of each conclusion. The plan uses the terms of First-Order Logic. The typed-data side follows the Description Logic family more closely. RDF Schema, OWL and JSON-LD's `@context` build on Description Logic.

The reasoner reads input from two sources. The first is typed-data documents such as JSON-LD. Their triples enter the fact store as facts. The second is the step prose that authors write in feature files. The same prose declares predicates and rules, asserts facts, requests proofs and reads the results.

Most applications have three separate artifacts: a specification, an implementation and a test suite. The lines of a logical description serve as all three. The lines that state what holds are the lines the reasoner checks for truth. The reasoner that runs the application is the same one that derives its conclusions. The same description provides the instructions a person follows to use the system, the explanation of a particular result, and the criterion the tests check.

Steps that act on the outside world stay imperative. Such steps make network calls, sign, store and interact with a user agent. Their results enter the reasoner as facts under the predicate each step declares. The boundary between imperative action and logical derivation is explicit.

## Vocabulary

First-Order Logic and haibun use different terms for some of the same things. This document uses haibun's term where the two differ.

An **individual** is a particular thing that facts and rules describe. A reference identifies it: a URI, a DID, a vertex id or a JSON-LD `@id`. The system doesn't handle a thing directly. It handles a reference and the records stored under that reference. Two parties may refer to the same individual with different references. Two individuals are equal when their references resolve to the same thing. Equality doesn't require byte-identical references.

A **domain** (FOL: *sort*) is a named category. `set of meal is ["dinner", "lunch", "breakfast"]` declares one. A reference is read under a domain. The domain fixes which facets of the referent the rules use. A domain doesn't describe the referent in full. It declares the properties, relationships and states that the rules use.

A **predicate** is a named relationship with typed parts. `signed_by(Document, Signer)` has two parts. `Ready(Meal)` has one. Each part has a declared domain. The domain states the kind of individual the part accepts. A predicate name is itself a reference. In JSON-LD it is an IRI. In haibun it is a declared name that maps to an IRI. A predicate becomes a **fact** when its parts are specific individuals: `signed_by(document-7, did:web:example.org)`. A fact is a triple of references: subject, predicate and object. Each reference can be resolved.

A **variable** stands for any individual: `x`, `y`. In haibun a variable is a step placeholder `{x}`. A variable lets one statement apply to every individual without naming each one.

The set of asserted facts is the **ABox** (assertion box, from Description Logic). In haibun it is the fact store in `FACT_GRAPH`.

The declared vocabulary is the **TBox** (terminological box) or *signature*. It contains the domains, predicates and rules. Haibun doesn't have its own term for the whole TBox. The closest published form is the `ConcernCatalog`. A definition-detail result of the show steps step holds the catalog's matching concerns.

A **rule** has a head and a body. The head is derived when the body's facts hold: `Ready(m) ← Cooked(m) ∧ Plated(m)`. A haibun rule is a `waypoint` with a goal-shaped proof inside an `Activity:` block.

Inference runs in two directions. **Backward chaining** starts from a goal and searches the rules for facts that support it. It binds variables as it searches. **Forward chaining** starts from facts and rules and derives every new fact those entail. The substitution that makes a rule's head match a goal is a **unifier**.

The result of a successful inference is a **proof tree**: the goal at the root, the rule applied at each interior node, the unifier at that node, the supporting facts at the leaves. A failed inference returns a partial tree. The partial tree marks the first sub-goal that couldn't be proved.

## Haibun steps

A step in haibun is a single line in a feature file that matches a gwta pattern. Every step evaluates to true or false. A step that succeeds returns `OK`. A step that fails returns `actionNotOK`. A scenario passes when every step in it is true.

A step's line determines its logical role:

| Step                                        | Role                                            |
| ------------------------------------------- | ----------------------------------------------- |
| `assert dinner is "ready"`                  | fact assertion                                  |
| `dinner is "ready"`, `fact …`               | fact query                                      |
| `ensure …`, `resolve …`                     | goal-directed proof search                      |
| `every {x} in D is …`, `some {x} in D is …` | quantification                                  |
| `didn't …`, `where …`, `any of …`           | connective                                      |
| navigate, sign, fetch, ingest, click        | outside-world action; results enter as facts    |
| capital-letter sentence ending in `.`       | narrative prose, dispatched as a no-op          |

A query step's truth value is whether the fact holds. An `ensure` step's truth value is whether the goal is provable. A `not` step's truth value is the inverse of its inner result. Every step receives a `seqPath`. Every fact a step asserts carries that `seqPath` as provenance.

Sources other than authored steps add triples to the fact store. Triples can be read in bulk from typed-data sources: a JSON-LD document under the predicates its `@context` declares, a hypermedia response under predicates that name its links and attributes, an HTTP observation stream as one triple per request. The dispatcher asserts a step's retained products as facts under the step's `productsDomain` or `productsDomains`. `FACT_GRAPH` stores all the resulting triples. Any rule can query them.

## The signature in feature prose

A domain is declared with `set of D is [values]`, `ordered set of D is [values]` or `set of D as [superdomains]`. The first lists the allowed values. The second lists the values in order for comparison. The third declares a domain whose values are those of the listed superdomains.

A predicate is declared with `predicate {pattern}`:

```
predicate {x:meal} is {state:meal-state}
predicate {issuer:Issuer} delegates to {p:Person} for {a:Action} at {v:Venue}
```

The verb in a line that uses the predicate determines whether the line asserts or queries. `assert dinner is "ready"` writes the fact. The bare `dinner is "ready"` queries it.

A rule is a parameterized waypoint with a goal-shaped proof:

```
Activity: Get a meal ready
waypoint {m:meal} is "ready" with {m} is "cooked" and {m} is "plated"
```

This rule reads as `Ready(m) ← Cooked(m) ∧ Plated(m)` for any `m` of domain `meal`. The reasoner runs the activity body when the proof fails. The body's steps add facts to the fact store. The reasoner rechecks the proof after those steps.

A universal rule is declared with `for every {x:D} where {body}, {head}`:

```
for every {x:meal} where {x} is "cooked", assert {x} is "edible"
```

The reasoner adds an `edible` fact whenever a matching `cooked` fact is asserted. The reasoner uses the same rule to prove an `edible` goal from the matching `cooked` fact.

## Facts about individuals

Facts are stored as triples in `FACT_GRAPH`. The subject is the individual that the fact describes. The predicate is the relation. The object is the value or related individual.

```
assert dinner is "ready"
assert dinner contains "tomato"
fact dinner is "ready"
not fact dinner is "raw"
```

Each fact carries its provenance as a quad property: the `seqPath` of the step that asserted it, the rule (if any) whose firing derived it, the parent goal (if any) that led to that derivation. A proof tree can be rebuilt from the fact store.

## Goals and proofs

A goal is a predicate application that may contain variables: `Ready(dinner)`, `Ready(x)`, `Owns(alice, ?)`.

```
ensure dinner is "ready"
resolve "dinner is ready"
some {x:meal} is "ready"
every {x:meal} where {x} is "cooked", {x} is "edible"
```

`ensure` runs backward chaining. It runs the activity body when the proof fails and retries the proof afterward. `resolve` runs backward chaining as a query and returns a tree. `some` and `every` quantify over a domain. A quantifier whose head is a fact-shaped statement registers a rule that the reasoner uses in both directions. Any other quantifier runs as bounded iteration.

A proof tree renders as:

```
is(dinner, ready)
├── rule: is(m, ready) ← is(m, cooked) ∧ is(m, plated)   [m ↦ dinner]
│   ├── is(dinner, cooked)   fact at seq 0.1.2.3
│   └── is(dinner, plated)   asserted by activity body at seq 0.1.4.1
```

The monitor renders the same tree. An RPC `derive "{goal}"` returns it.

## The hypermedia surface

The show steps step (`Haibun-showSteps`) returns the steps and domains that match a text. Its definition-detail result holds the matching concerns of the `ConcernCatalog` as well. The plan adds a `predicates` section to the catalog. The section lists each declared predicate's name, the domain of each part and a sample step. The SPA's affordances panel reads the catalog and renders the predicates as affordances. An MCP client reads it as a list of tools. An LLM caller reads it as typed tool definitions.

`signature.list` returns the full signature: domains, predicates, rules, functions. `derive "{goal}"` returns a proof tree, or a partial tree that marks the unprovable sub-goal.

## Negation, equality, functions

`didn't {statement}` is negation as failure. The negation succeeds when the statement can't be proved.

`absent {statement}` is the closed-world counterpart. It is an authored assertion that the statement is false. It separates the case where a proof doesn't exist from the case where a proof of falsity exists.

`{a} is the same as {b}` declares equality between two individuals. The reasoner treats them as one. A DID alias whose two strings resolve to the same key is the common case.

A function declaration `function {name}({parts}) → D` registers a domain-typed projection. The reasoner evaluates functions during proof search. A function's result replaces its application. A function is shorthand for a predicate whose final part is the result.

## Surface syntax

`✓` marks a step that exists in haibun. The phases below add the unmarked lines.

```
✓ set of D is [values]
✓ ordered set of D is [values]
✓ set of D as superdomain is [values]

  predicate {pattern}

  assert {subject} {predicate} {value}
  {subject} {predicate} {value}                       (query form)
✓ didn't {statement}
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

✓ show affordances (with the chain's lint findings)
  show derivation of "{statement}"

✓ show steps                                           (returns steps + ConcernCatalog)
  signature.list                                       (returns domains + predicates + rules)
```

Every line follows haibun's step format. The format doesn't require an additional bracket convention or tooling.

## Phases

The plan delivers the system in phases. Each phase keeps the steps of earlier phases working.

### Phase 0, Per-subject facts

Two steps assert and query ABox facts directly:

```
assert {subject:string} {predicate:string} {value:string}
fact {subject:string} {predicate:string} {value:string}
```

The first writes a `(subject, predicate, value)` quad into `FACT_GRAPH`. The second succeeds when the quad exists. The quad holds its provenance as a property. The provenance is the `seqPath` of the asserting step. Later phases read and write the same graph.

### Phase 1, Predicates as declarations

A declarative line registers a predicate with named, domain-typed parts:

```
predicate {subject:meal} is {state:meal-state}
```

The parser builds a predicate descriptor `(name, arg-domains)`. The verb in a line that uses the predicate determines whether the line asserts or queries. The catalog that show steps returns gains a `predicates` section.

### Phase 2, Unification in the resolver

Goals and rule heads become predicate applications that may contain variables. The resolver computes a most-general unifier of the goal and the head. The resolver applies the unifier to the body's conjuncts.

`ensure dinner is "ready"` selects the rule `{m} is "ready" with …` and binds `m ↦ dinner`. The body's `{m}` references resolve to `dinner`.

### Phase 3, Rule chaining

`ensure`'s proof check re-solves goal-shaped proofs recursively. A predicate application that matches another rule's head triggers a sub-derivation. A depth limit and a cycle guard bound the recursion.

### Phase 4, Proof objects

Every successful `ensure` and `resolve` returns a proof tree. A failure returns a partial tree that marks the first unprovable sub-goal. The monitor renders trees. The affordances panel shows a `show derivation` action for each reachable goal. The RPC surface exposes `derive` to external callers.

### Phase 5, Universals as rules

`for every {x} where {x} is "raw", {x} is "uncooked"` registers the rule `Uncooked(x) ← Raw(x)`. The forward chainer runs on each new `raw` fact and adds the corresponding `uncooked` fact. The backward chainer uses the rule to prove `uncooked` goals from `raw` facts.

### Phase 6, Equality and classical negation

`{a} is the same as {b}` registers equality with congruence. Queries normalize each individual to its canonical representative. `absent {statement}` adds a closed-world falsity assertion separate from negation as failure.

### Phase 7, Functions

`function {name}({args}) → D` registers a domain-typed projection. The reasoner evaluates function applications during proof search.

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

`is(dinner, ready)` unifies with the waypoint head and binds `m ↦ dinner`. The sub-goal `is(dinner, cooked)` is in the fact store. The sub-goal `is(dinner, plated)` isn't in the fact store. A rule head doesn't match it either. The activity body runs and asserts it. The second check passes.

```
is(dinner, ready)
├── rule: is(m, ready) ← is(m, cooked) ∧ is(m, plated)   [m ↦ dinner]
│   ├── is(dinner, cooked)   fact at seq 0.1.2.3
│   └── is(dinner, plated)   asserted by activity body at seq 0.1.4.1
```

## Worked example: certificates

```
predicate {c:Certificate} is signed by {i:Authority}
predicate {i:Authority} controls {k:VerificationMethod}
predicate {c:Certificate} is valid

Activity: Validate a certificate
waypoint {c:Certificate} is valid with {c} is signed by {i} and {i} controls {k} and the signature of {c} verifies under {k}

ensure certificate is valid
```

The partial tree of a failed validation names the unmet conjunct. An example is "the signature did not verify under did:web:tethys.osf#key-1".

## Worked example: capability delegation

```
predicate {p:Person} may {a:Action} at {v:Venue}
predicate {i:Issuer} delegates to {p:Person} for {a:Action} at {v:Venue}
predicate {p:Person} holds a capability granted by {i:Issuer}

Activity: Authorize at a venue
waypoint {p:Person} may {a:Action} at {v:Venue} with {p} holds a capability granted by {i} and {i} delegates to {p} for {a} at {v}

ensure "child" may "swim" at "pool"
```

The reasoner follows the delegation chain backward. The proof tree is the delegation chain.

## Worked example: observation + rule

```
for every {req} observed in http-trace where {req}/status is more than 399, assert {req} is "broken"

for every {req} where {req} is "broken", assert pipeline is "degraded"

ensure pipeline is "healthy"
```

Runtime observations become facts. Facts trigger rules that derive further facts. The result of the pipeline goal reflects the accumulated facts.

## Scope

Steppers act on the world. The reasoner evaluates goals against rules and facts. Steppers and the reasoner are separate components.

Proof search runs backward from each goal through the rule set. A universal rule runs forward on each new matching fact as well. The surface is haibun feature prose.

Finite domains, depth limits and cycle guards bound proof search.

The system targets multi-step plans, capability checks, declarative validation and entailment from runtime observations. Deterministic single-pass flows stay plain step sequences.

## Open questions

How is a predicate's per-subject key derived from a `productsDomain` payload? The proposal is to read the declared `idField`, or the `seqPath` when an `idField` isn't declared.

How does a quad store hold a predicate with more than two parts? The proposal is to reify each tuple as an anonymous individual whose type is the relation.

Where does the reasoner run? The proposal is to run it in-process for each feature, with a `derive` RPC for clients. An out-of-process inference service can follow if needed.

Should `signature.list` and `derive` extend the existing show steps step, or should a new namespace declare them?

How do existing `productsDomain` declarations migrate? The proposal is to derive a one-part predicate from each declaration. Authors can declare richer signatures afterward.

## Summary

The plan has five parts. A signature declares domains, predicates and rules. A fact store holds per-subject facts. A reasoner runs in both directions. A proof tree records why each conclusion holds. A hypermedia surface publishes the signature to every client. Feature authors write all of it in haibun's step prose.
