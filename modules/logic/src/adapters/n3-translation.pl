% Translates an N3 rule set into Prolog clauses for the engine that runs haibun.pl. EYE parses the rule set first: implies/3 holds
% each forward rule as Prolog terms, and EYE asserts each backward rule as a clause of the predicate it concludes. translate/3
% reads those terms and the rule set's ground triples, its axioms, and emits clauses for the module the check names:
%   - a premise triple whose predicate only the rule set's axioms state is evaluated at translation: each axiom that matches
%     yields a rule of its own, so a variable predicate it binds becomes constant;
%   - with every predicate constant, each data predicate is a Prolog predicate '<iri>'(S, O) of the module, fed by fact/3 (a
%     check's facts) and axiom/3 (the rule set's); where a predicate stays variable, every triple is t(S, P, O);
%   - log:notIncludes becomes negation, log:collectAllIn findall and log:includes a call, each over the translated formula; every
%     other built-in calls n3_builtins;
%   - a predicate in a positive cycle is tabled;
%   - a rule in a cycle through negation or aggregation, a built-in n3_builtins doesn't define, negation over tabled triples and a
%     form the translation doesn't read are refused, each with the rule it occurs in.
:- module(n3_translation, [hold_eye/0, translate/3]).
:- use_module(library(lists)).
:- use_module(library(apply)).
:- use_module(library(ordsets)).
:- use_module(library(ugraphs)).
:- use_module(library(listing)).
:- use_module(library(yall)).
:- dynamic(axiom/1), dynamic(refusal/2), dynamic(triple_mode/0), dynamic(held_by_eye/1).

% The clauses EYE holds for IRI-named predicates before it reads the rule set, so a backward rule is a clause EYE read from it.
hold_eye :- retractall(held_by_eye(_)), forall((iri_predicate(H), catch(clause(user:H, _, Ref), _, fail)), assertz(held_by_eye(Ref))).
iri_predicate(H) :- current_predicate(user:N/2), atom(N), sub_atom(N, 0, 1, _, '<'), functor(H, N, 2).
% The rule set's ground triples, which EYE holds as clauses without a body.
axiom_of(t(N, S, O)) :- iri_predicate(H), H =.. [N, S, O], \+ is_builtin(N), catch(clause(user:H, true, Ref), _, fail), \+ held_by_eye(Ref).
% The rule set's backward rules, as EYE holds them, in the order written.
backward(bw(t(N, S, O), Ps)) :- iri_predicate(H), H =.. [N, S, O], \+ is_builtin(N), catch(clause(user:H, B, Ref), _, fail), B \== true, \+ held_by_eye(Ref), literals(B, Ps).

builtin_namespace('<http://www.w3.org/2000/10/swap/').
builtin_namespace('<http://eulersharp.sourceforge.net/2003/03swap/').
builtin_namespace('<http://www.w3.org/2007/rif-builtin').
builtin_namespace('<urn:haibun:read>').
builtin_namespace('<urn:haibun:effect>').
builtin_namespace('<urn:haibun:call>').
is_builtin(P) :- atom(P), builtin_namespace(NS), sub_atom(P, 0, _, _, NS), !.
log(L, A) :- atomic_list_concat(['<http://www.w3.org/2000/10/swap/log#', L, '>'], A).
% A built-in n3_builtins defines itself, rather than one it reaches through the user module.
defined(N) :- atom(N), functor(H, N, 2), predicate_property(n3_builtins:H, implementation_module(n3_builtins)).

% literals(+EyeConjunction, -Literals): EYE's premise or conclusion as a list of literals.
literals(true, []) :- !.
literals((A, B), L) :- !, literals(A, LA), literals(B, LB), append(LA, LB, L).
literals(G, [L]) :- literal(G, L).
literal(exopred(P, S, O), t(P, S, O)) :- !.
literal(G, naf(F)) :- G =.. [N, _, Formula], log(notIncludes, N), !, literals(Formula, F).
literal(G, inc(F)) :- G =.. [N, _, Formula], log(includes, N), !, literals(Formula, F).
literal(G, collect(V, F, List)) :- G =.. [N, [V, Formula, List], _], log(collectAllIn, N), !, literals(Formula, F).
literal(G, b(N, S, O)) :- G =.. [N, S, O], is_builtin(N), !.
literal(G, t(N, S, O)) :- G =.. [N, S, O], !.
literal(G, other(G)).

% The rules EYE holds: the forward rules, and the query's rules, whose conclusions are answer/3.
rule(rule(Ps, Cs)) :- user:implies(P, C, _), C \= answer(_, _, _), C \= (answer(_, _, _), _), literals(P, Ps), literals(C, Cs).
query(query(Ps, A)) :- user:implies(Pr, C, _), ( C = answer(_, _, _) ; C = (answer(_, _, _), _) ), literals(Pr, Ps), answers(C, As), member(A, As).
answers((A, B), [A|As]) :- !, answers(B, As).
answers(A, [A]).

% A rule as a refusal names it: its premises and conclusions, with its variables lettered.
rule_text(Ps, Cs, Text) :- copy_term(Ps-Cs, P-C), numbervars(P-C, 0, _), format(string(Text), "~p => ~p", [P, C]).
refuse(Ps, Cs, Reason) :- rule_text(Ps, Cs, Text), ( refusal(Text, Reason) -> true ; assertz(refusal(Text, Reason)) ).

% Specialization over the axioms.
head_predicate(rule(_, Cs), P) :- member(t(P, _, _), Cs).
static(Rules, P) :- atom(P), axiom(t(P, _, _)), \+ (member(R, Rules), head_predicate(R, H), H == P).
specialize(Rules, Out) :-
	(   select(R, Rules, Rest), R = rule(Ps, Cs), select(t(P, S, O), Ps, Ps1), static(Rules, P)
	->  findall(rule(Ps1c, Csc), (copy_term(t(P, S, O)-Ps1-Cs, t(P, S1, O1)-Ps1c-Csc), axiom(t(P, S1, O1))), New),
		append(Rest, New, Rules1), specialize(Rules1, Out)
	;   Out = Rules ).
variable_predicate(Ls) :- member(L, Ls), sub_literal(L, t(P, _, _)), var(P), !.
sub_literal(L, L).
sub_literal(naf(F), L) :- member(X, F), sub_literal(X, L).
sub_literal(inc(F), L) :- member(X, F), sub_literal(X, L).
sub_literal(collect(_, F, _), L) :- member(X, F), sub_literal(X, L).

% Dependencies: a rule's head on each predicate of its premises, with a sign; a variable predicate stands for every predicate.
dependency(t(P, _, _), S, S, Q) :- ( var(P) -> Q = any ; Q = P ).
dependency(naf(F), _, neg, Q) :- member(X, F), dependency(X, neg, _, Q).
dependency(inc(F), S, S, Q) :- member(X, F), dependency(X, S, _, Q).
dependency(collect(_, F, _), _, neg, Q) :- member(X, F), dependency(X, neg, _, Q).
edges(Rules, Edges) :-
	findall(H-P-Sign-R, (member(R, Rules), R = rule(Ps, _), head_predicate(R, H0), (var(H0) -> H = any ; H = H0), member(L, Ps), dependency(L, pos, Sign, P)), E0),
	sort(E0, Edges).
% The recursive predicates; a rule whose head depends on itself through negation or aggregation is refused.
stratified(Edges, Recursive) :-
	findall(A-B, member(A-B-_-_, Edges), Pairs), findall(V, (member(A-B, Pairs), (V = A ; V = B)), Vs0), sort(Vs0, Vs),
	vertices_edges_to_ugraph(Vs, Pairs, G), transitive_closure(G, C),
	findall(A, (member(A-_-_-_, Edges), reaches(C, A, A)), R0), sort(R0, Recursive),
	forall((member(A-B-neg-rule(Ps, Cs), Edges), reaches(C, B, A)), refuse(Ps, Cs, "its head depends on itself through negation or aggregation, so its clauses aren't stratified")).
reaches(C, A, B) :- member(A-Ns, C), ord_memberchk(B, Ns).

% Emission. A data predicate is '<p>'(S, O) of the module, or t(S, P, O) where a predicate stays variable.
goal(M, t(P, S, O), M:G) :- \+ triple_mode, !, G =.. [P, S, O].
goal(M, t(P, S, O), M:t(S, P, O)).
% The body's order: each built-in as soon as its inputs are bound (a functional built-in's subject, a test's both sides), else the
% next data literal in the rule's order; negation and aggregation last, over what the body bound.
body(_, _, [], true).
body(M, Rule, Ls, B) :- order(Ls, Os), maplist(body_goal(M, Rule), Os, Gs), conjunction(Gs, B).
order(Ls, Os) :- partition(is_negation, Ls, N, Rest), greedy(Rest, [], Os0), append(Os0, N, Os).
greedy([], _, []) :- !.
greedy(Ls, Bound, [B|Os]) :- select(B, Ls, Rest), B = b(_, _, _), ready(B, Bound), !, term_variables(B, Vs), append(Bound, Vs, Bound1), greedy(Rest, Bound1, Os).
greedy(Ls, Bound, [D|Os]) :- select(D, Ls, Rest), D \= b(_, _, _), !, term_variables(D, Vs), append(Bound, Vs, Bound1), greedy(Rest, Bound1, Os).
greedy(Ls, _, Ls).
ready(b(N, S, O), Bound) :- ( functional(N) -> In = S ; In = S-O ), term_variables(In, Vs), forall(member(V, Vs), (member(W, Bound), W == V)).
functional(N) :-
	member(NS-Local, [string-concatenation, string-scrape, math-sum, list-first, list-rest, list-firstRest, list-append, list-length, log-equalTo]),
	atomic_list_concat(['<http://www.w3.org/2000/10/swap/', NS, '#', Local, '>'], N), !.
is_negation(naf(_)).
is_negation(collect(_, _, _)).
body_goal(M, _, t(P, S, O), G) :- goal(M, t(P, S, O), G).
body_goal(M, Rule, inc(F), B) :- body(M, Rule, F, B).
body_goal(M, Rule, naf(F), (\+ B)) :- body(M, Rule, F, B), ( triple_mode -> Rule = Ps-Cs, refuse(Ps, Cs, "it negates a formula over tabled triples") ; true ).
body_goal(M, Rule, collect(V, F, L), findall(V, B, L)) :- body(M, Rule, F, B).
body_goal(_, Rule, b(N, S, O), n3_builtins:G) :- G =.. [N, S, O], ( defined(N) -> true ; Rule = Ps-Cs, format(string(R), "it calls the built-in ~w, which n3_builtins doesn't define", [N]), refuse(Ps, Cs, R) ).
body_goal(_, Ps-Cs, other(G), fail) :- format(string(R), "it holds ~p, a form the translation doesn't read", [G]), refuse(Ps, Cs, R).
conjunction([G], G) :- !.
conjunction([G|Gs], (G, B)) :- conjunction(Gs, B).

% A forward rule's clauses: one per conclusion, each existential variable a Skolem term over the rule's premise variables.
clauses(M, N, rule(Ps, Cs), Clauses) :-
	term_variables(Ps, PV), term_variables(Cs, CV), exclude(premise_variable(PV), CV, Ex),
	skolems(Ex, N, 1, PV), body(M, Ps-Cs, Ps, B), findall((G :- B), (member(C, Cs), goal(M, C, G)), Clauses).
premise_variable(PV, V) :- member(W, PV), W == V, !.
skolems([], _, _, _).
skolems([V|Vs], N, I, PV) :- V = sk(N, I, PV), I1 is I + 1, skolems(Vs, N, I1, PV).

% translate(+Module, -Program, -Refusals): Program is the clauses of the rule set and its query in Module, as text; Refusals is
% each rule the translation refuses, as Rule-Reason.
translate(M, Program, Refusals) :-
	retractall(refusal(_, _)), retractall(triple_mode), retractall(axiom(_)), forall(axiom_of(A), assertz(axiom(A))),
	findall(R, rule(R), Rules0), findall(rule(Ps, [qa(A)]), query(query(Ps, A)), Queries0),
	append(Rules0, Queries0, All0), specialize(All0, All),
	partition([rule(_, Cs)]>>(Cs \= [qa(_)]), All, Rules, QueryRules), findall(query(Ps, A), member(rule(Ps, [qa(A)]), QueryRules), Queries),
	findall(L, (member(rule(Ps, Cs), Rules), (member(L, Ps) ; member(L, Cs))), RuleLiterals), findall(L, (member(query(Ps, _), Queries), member(L, Ps)), QueryLiterals),
	( (variable_predicate(RuleLiterals) ; variable_predicate(QueryLiterals)) -> assertz(triple_mode) ; true ),
	findall(B, backward(B), Backward), findall(rule(Ps, [H]), member(bw(H, Ps), Backward), BackwardRules), append(Rules, BackwardRules, DependentRules),
	edges(DependentRules, Edges), stratified(Edges, Recursive),
	findall(C, (nth1(N, Rules, R), clauses(M, N, R, Cs), member(C, Cs)), ForwardClauses),
	findall((G :- B), (member(bw(H, Ps), Backward), goal(M, H, G), body(M, Ps-[H], Ps, B)), BackwardClauses),
	findall((M:answer(P, S, O) :- B), (member(query(Ps, answer(P, S, O)), Queries), body(M, Ps-[answer(P, S, O)], Ps, B)), QueryClauses),
	findall(P, (member(R, Rules), head_predicate(R, P), atom(P)), HP), findall(P, (member(bw(t(P, _, _), _), Backward), atom(P)), BH),
	findall(P, (member(L, RuleLiterals), sub_literal(L, t(P, _, _)), atom(P)), RP), findall(P, (member(L, QueryLiterals), sub_literal(L, t(P, _, _)), atom(P)), QP),
	append([HP, BH, RP, QP], AP), sort(AP, Predicates),
	findall(axiom(P, S, O), axiom(t(P, S, O)), Axioms),
	(   triple_mode
	->  Feeds = [(M:t(S, P, O) :- (M:fact(P, S, O) ; M:axiom(P, S, O)))], ( Recursive == [] -> Tabled = [] ; Tabled = [t/3] )
	;   findall((M:G :- (M:fact(P, S, O) ; M:axiom(P, S, O))), (member(P, Predicates), G =.. [P, S, O]), Feeds), findall(P/2, (member(P, Recursive), atom(P)), Tabled)
	),
	findall(Rule-Reason, refusal(Rule, Reason), Refusals),
	with_output_to(string(Program), (
		format(":- dynamic(~q), dynamic(~q).~n", [M:fact/3, M:axiom/3]),
		forall(member(T, Tabled), portray_clause((:- table(M:T)))),
		forall(member(A, Axioms), portray_clause(M:A)),
		forall(member(C, Feeds), portray_clause(C)),
		forall(member(C, ForwardClauses), portray_clause(C)),
		forall(member(C, BackwardClauses), portray_clause(C)),
		forall(member(C, QueryClauses), portray_clause(C)))).
