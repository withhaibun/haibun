% The logic engine's program. A line's proof is one query, and each effect it reaches is one more. prove/3 starts a
% Prolog engine, named by the line, that evaluates the line's term. Where the proof reaches an effect (a built-in call, a
% record's opening or closing, a read, a waypoint's rule or its proof, or a wait), effect/4 yields the request and the query returns it. The pipeline performs the effect, and resume/3 posts its outcome to the line's
% engine, which continues from the effect. The engine holds its own stacks between queries, so a query never holds the runtime
% across an await, the proofs of several callers interleave at each effect, and a query evaluates only the part of the
% proof after the effect it resumes, however many effects its line performed.
%
% A verdict is proved, refuted, unknown or contradiction. A built-in that passed is proved, one that failed is refuted,
% and one that couldn't run is unknown. Negation is negation as failure scoped to the outcomes of its line: a query reads
% only the outcome of the effect its own line performed. The engine doesn't hold facts: a proof reads them through read/5,
% and TypeScript answers each read from the store within the line's authority. Each part of a proof, once it ends, is
% asserted as part/4, which only the N3 export reads.
:- module(haibun, [prove/3, resume/3, forget/1, n3_export/3]).
:- use_module(library(lists)).
:- use_module(library(apply)).
:- use_module(library(pairs)).

:- dynamic part/4.

% One bound holds every proof but until's: the depth of nested readings, the repetitions of whenever, and a waypoint's
% applications in ensure and in a line run alone. until is bounded by its deadline alone.
max_depth(1000).

% prove(+Top, +TermText, -Outcome): Outcome is _{verdict} where the line's proof ended, or the effect it needs.
prove(Top, TermText, Outcome) :-
    term_string(Term, TermText),
    engine_create(Done, top(Top, Term, Done), _, [alias(Top)]),
    engine_next(Top, Answer),
    outcome(Answer, Outcome).

top(T, Term, done(V)) :- ev(T, top, Term, [], [], [], 0, V).

% resume(+Top, +OutcomeText, -Outcome): continues the line's proof with the outcome of the effect it needed.
resume(Top, OutcomeText, Outcome) :- term_string(O, OutcomeText), engine_post(Top, O, Answer), outcome(Answer, Outcome).

outcome(done(V), _{verdict: V}) :- !.
outcome(need(K, P, R), _{need: K, path: P, request: RJ}) :- request_json(R, RJ).

% forget(+Top): removes the line's engine and the parts of its proof once its proof ended.
forget(Top) :- ( is_engine(Top) -> engine_destroy(Top) ; true ), retractall(part(Top, _, _, _)).

effect(K, P, R, O) :- engine_yield(need(K, P, R)), engine_fetch(O).

% read(+Path, +Bindings, +Patterns, +Template, -Found): Found is rows(Ts), each Template where every pattern q(S, P, O, G)
% matches a fact, or refused(Reason). A pattern's unbound positions are its variables: the read returns the values they take
% in each fact that holds the pattern's constants, and the engine joins the patterns by unification. The named graph node
% holds a node's own facts: a quantifier's members and a waypoint's arguments.
read(P, B, Ps, T, Found) :-
    maplist(variables_of, Ps, Vss), effect(read, P, read(Ps, B), Read),
    ( Read = facts(Rss) -> findall(T, maplist(member, Vss, Rss), Ts), Found = rows(Ts) ; Found = Read ).
variables_of(Q, Vs) :- Q =.. [q|Ts], include(var, Ts, Vs).

% child(+Parent, -Child): the next position under a node, Path-Counter, so a reading that proves its statements again takes
% new positions. The counter is a term in the node's frame.
child(P-Counter, C) :- arg(1, Counter, N0), N is N0 + 1, nb_setarg(1, Counter, N), append(P, [N], C).

outcome_verdict(passed, proved).
outcome_verdict(failed, refuted).
outcome_verdict(refused, unknown).

naf(proved, refuted).
naf(refuted, proved).
naf(unknown, unknown).
naf(contradiction, contradiction).

% worse(+Held, +Found, -Kept): a disjunction or a search without a proof is unknown where any part is unknown.
worse(unknown, _, unknown) :- !.
worse(_, unknown, unknown) :- !.
worse(W, _, W).

% ev(+Top, +Group, +Term, +Path, +Bindings, +Ancestors, +Depth, -Verdict): Group names the part of its parent's reading the
% term is proved in, which the N3 export reads.
% all(Xs): the statements a step states, proved in order under the step's own record, which is open while its action runs.
ev(T, G, all(Xs), P, B, A, D, V) :- !, conj(T, G, Xs, P-c(0), B, A, D, V, _).
ev(T, G, call(N), P, B, _, _, V) :- !, effect(call, P, call(N, B), O), outcome_verdict(O, V), assertz(part(T, P, G, call(V))).
ev(T, G, apply(M, W), P, B, A, D, V) :-
    !, ( memberchk(proving, A) -> Mode = prove ; Mode = run ), applied(T, Mode, M, W, P, B, A, D, V), assertz(part(T, P, G, node(apply, V))).
ev(T, G, Term, P, B, A, D, V) :-
    Term =.. [F, N | Args],
    effect(open, P, open(N, B), Opened),
    (   Opened == refused -> V = unknown
    ;   D1 is D + 1, max_depth(Max),
        ( D1 > Max -> V = unknown, Why = depth(Max) ; reading(F, N, Args, T, P-c(0), B, A, D1, V, Why) ),
        close(P, N, V, Why)
    ),
    assertz(part(T, P, G, node(F, V))).

% close(+Path, +Node, +Verdict, +Why): closes a node's record with its verdict and, where it isn't proved, the path of the
% part that determined it or the reason the engine states.
close(P, N, V, Why0) :- ( V == proved -> Why = none ; Why = Why0 ), effect(close, P, close(N, V, Why), _).

% conj(+Top, +Group, +Statements, +Parent, +Bindings, +Ancestors, +Depth, -Verdict, -Why): Why is the position of the first
% statement that isn't proved. A reading reads its node as Parent, Path-Counter.
conj(_, _, [], _, _, _, _, proved, none).
conj(T, G, [X|Xs], P, B, A, D, V, Why) :-
    child(P, C), ev(T, G, X, C, B, A, D, V0),
    ( V0 == proved -> conj(T, G, Xs, P, B, A, D, V, Why) ; V = V0, Why = C ).

reading(not, _, [Xs], T, P, B, A, D, V, Why) :- conj(T, all, Xs, P, B, A, D, V0, Why), naf(V0, V).
reading(where, _, [Cs, Xs], T, P, B, A, D, V, Why) :-
    conj(T, condition(1), Cs, P, B, A, D, VC, _),
    ( VC == proved -> conj(T, action(1), Xs, P, B, A, D, V, Why) ; V = proved ).
reading(any_of, _, [Alternatives], T, P, B, A, D, V, Why) :- any(T, Alternatives, P, B, A, D, refuted, none, V, Why).
reading(maybe, _, [Xs], T, P, B, A, D, proved, none) :- conj(T, all, Xs, P, B, A, D, _, _).
reading(waypoint, _, [], _, _, _, _, _, proved, none).
reading(waypoint, _, [Xs], T, P, B, A, D, V, Why) :- conj(T, all, Xs, P, B, [proving|A], D, V, Why).
reading(within, N, [Xs], T, Q, B, A, D, V, Why) :- Q = P-_, conj(T, all, Xs, Q, [N-within(P)|B], A, D, V, Why).
reading(some, N, [Xs], T, P, B, A, D, V, Why) :-
    members(N, P, B, Found),
    (   Found = rows([]) -> V = refuted, Why = empty
    ;   Found = rows(Ms) -> exists(T, N, Ms, Xs, P, B, A, D, refuted, none, V, Why)
    ;   V = unknown, Why = Found
    ).
reading(every, N, [Xs], T, P, B, A, D, V, Why) :-
    members(N, P, B, Found),
    ( Found = rows(Ms) -> for_all(T, N, Ms, Xs, P, B, A, D, V, Why) ; V = unknown, Why = Found ).
reading(whenever, _, [Cs, Xs], T, P, B, A, D, V, Why) :- repeat_while(T, Cs, Xs, P, B, A, D, 1, V, Why).
reading(until, N, [Xs], T, P, B, A, D, V, Why) :- attempts(T, N, Xs, P, B, A, D, 1, V, Why).
reading(ensure, _, [[apply(M, W)]], T, P, B, A, D, V, C) :- !, child(P, C), applied(T, ensure, M, W, C, B, A, D, V), assertz(part(T, C, all, node(apply, V))).
reading(ensure, _, [_], _, _, _, _, _, refuted, not_waypoint).

any(_, [], _, _, _, _, W, Why, W, Why).
any(T, [Xs|Rest], P, B, A, D, W, _, V, Why) :-
    conj(T, all, Xs, P, B, A, D, V0, W0),
    ( V0 == proved -> V = proved, Why = none ; worse(W, V0, W1), any(T, Rest, P, B, A, D, W1, W0, V, Why) ).

members(N, P-_, B, Found) :- read(P, B, [q(N, member, M, node)], M, Found).

exists(_, _, [], _, _, _, _, _, W, Why, W, Why).
exists(T, N, [M|Ms], Xs, P, B, A, D, W, _, V, Why) :-
    conj(T, all, Xs, P, [N-M|B], A, D, V0, W0),
    ( V0 == proved -> V = proved, Why = none ; worse(W, V0, W1), exists(T, N, Ms, Xs, P, B, A, D, W1, W0, V, Why) ).

for_all(_, _, [], _, _, _, _, _, proved, none).
for_all(T, N, [M|Ms], Xs, P, B, A, D, V, Why) :-
    conj(T, all, Xs, P, [N-M|B], A, D, V0, W0),
    ( V0 == proved -> for_all(T, N, Ms, Xs, P, B, A, D, V, Why) ; V = V0, Why = W0 ).

% whenever: repeat the action while the condition holds, within the bound.
repeat_while(_, _, _, _, _, _, _, K, unknown, depth(Max)) :- max_depth(Max), K > Max, !.
repeat_while(T, Cs, Xs, P, B, A, D, K, V, Why) :-
    conj(T, condition(K), Cs, P, B, A, D, VC, _),
    (   VC == proved ->
        conj(T, action(K), Xs, P, B, A, D, VX, WX),
        ( VX == proved -> K1 is K + 1, repeat_while(T, Cs, Xs, P, B, A, D, K1, V, Why) ; V = VX, Why = WX )
    ;   V = proved, Why = none
    ).

% until: prove the statements again after each wait, until they hold or the wait reports the deadline passed.
attempts(T, N, Xs, P, B, A, D, K, V, Why) :-
    conj(T, proof(K), Xs, P, B, A, D, V0, _),
    (   V0 == proved -> V = proved, Why = none
    ;   P = Path-_, effect(wait, Path, wait(N, K), Waited),
        ( Waited == again -> K1 is K + 1, attempts(T, N, Xs, P, B, A, D, K1, V, Why) ; V = V0, Why = expired )
    ).

% A waypoint's rule: its head holds where its proof holds, and its activity is the plan that makes the proof hold. The proof of a
% head is the reasoner's, over the waypoints' rules as N3, which a waypoint effect requests (waypoint/7). In a proof, a head is a
% goal of the reasoner, which opens and closes its record. ensure reads P ∨ (¬P ∧ [A]P), and a waypoint line run alone reads
% P ∨ [A], where the activity runs between the reasoner's proofs of P; beneath an activity the ancestors don't hold `proving`.
% The rule effect states whether the waypoint has a proof, its activity, and `cycle` where the application repeats one above it.
applied(T, prove, M, _, P, B, _, _, V) :- !, waypoint(T, prove, M, P-c(0), B, proof(1), V-_).
applied(T, Mode, M, W, P, B, A, D, V) :-
    effect(open, P, open(M, B), Opened),
    (   Opened == refused -> V = unknown
    ;   read(P, B, [q(M, K, X, node)], K-X, Read),
        (   Read = rows(Pairs) ->
            effect(rule, P, rule(W), rule(HasProof, Activity, Bound)),
            D1 is D + 1, max_depth(Max),
            (   Bound \== none -> V = unknown, Why = Bound
            ;   D1 > Max -> V = unknown, Why = depth(Max)
            ;   exclude(==(proving), A, Acting), plan(Mode, T, M, HasProof, Activity, P-c(0), [M-args(Pairs)|B], Acting, D1, V, Why)
            )
        ;   V = unknown, Why = Read
        ),
        close(P, M, V, Why)
    ).

% ensure judges the head's proof with its stated falsities, runs the activity where they don't prove it, and judges them again;
% a falsity also reads the verdict of an activity that doesn't hold. A line run alone checks the proof, and runs the activity
% where it doesn't hold.
plan(ensure, T, M, HasProof, Activity, Q, B, A, D, V, Why) :-
    waypoint(T, judge, M, Q, B, proof(1), V0-W0),
    (   ( HasProof == false ; memberchk(V0, [proved, contradiction]) ) -> V = V0, Why = W0
    ;   conj(T, activity(1), Activity, Q, B, A, D, VA, WA),
        ( VA == proved -> waypoint(T, judge, M, Q, B, proof(2), V-Why) ; waypoint(T, state(VA, WA), M, Q, B, activity(1), V-Why) )
    ).
plan(run, _, _, false, [], _, _, _, _, refuted, no_proof) :- !.
plan(run, T, M, HasProof, Activity, Q, B, A, D, V, Why) :-
    ( HasProof == false -> V0 = refuted, W0 = none ; waypoint(T, check, M, Q, B, proof(1), V0-W0) ),
    (   V0 == proved -> V = proved, Why = none
    ;   Activity == [] -> V = V0, Why = W0
    ;   conj(T, activity(1), Activity, Q, B, A, D, V, Why)
    ).

% waypoint(+Top, +Mode, +Node, +Parent, +Bindings, +Group, -Verdict-Why): the reasoner's proof of the head a node applies, whose
% lines take the positions after the parent's counter in the group, and whose parts the N3 export reads.
waypoint(T, Mode, M, P-Counter, B, G, V-Why) :-
    arg(1, Counter, N0),
    effect(waypoint, P, waypoint(Mode, M, B, N0, G), proved(V, Why, Used, Parts)),
    N is N0 + Used, nb_setarg(1, Counter, N),
    forall(member(part(C, G1, K), Parts), assertz(part(T, C, G1, K))).

% Requests as JSON-ready dicts.
request_json(call(N, B), _{node: N, bindings: Bs}) :- bindings_json(B, Bs).
request_json(open(N, B), _{node: N, bindings: Bs}) :- bindings_json(B, Bs).
request_json(read(Ps, B), _{patterns: Js, bindings: Bs}) :- maplist(pattern_json, Ps, Js), bindings_json(B, Bs).
request_json(close(N, V, falsity(R)), _{node: N, verdict: V, why: _{falsity: R}}) :- !.
request_json(close(N, V, Why), _{node: N, verdict: V, why: W}) :- ( is_list(Why) -> W = Why ; term_to_atom(Why, W) ).
request_json(rule(W), _{rule: W}).
request_json(waypoint(state(V, Why), N, B, Base, G), _{mode: state, node: N, bindings: Bs, base: Base, group: GA, given: _{verdict: V, why: WA}}) :-
    !, bindings_json(B, Bs), term_to_atom(G, GA), term_to_atom(Why, WA).
request_json(waypoint(Mode, N, B, Base, G), _{mode: Mode, node: N, bindings: Bs, base: Base, group: GA}) :- bindings_json(B, Bs), term_to_atom(G, GA).
request_json(wait(N, K), _{node: N, attempt: K}).

% A pattern states each of its constants, and leaves out each position that is its variable.
pattern_json(q(S, P, O, G), J) :- findall(K-X, ( member(K-X, [subject-S, predicate-P, object-O, namedGraph-G]), nonvar(X) ), Pairs), dict_pairs(J, _, Pairs).

% A binding is a quantifier's member, a waypoint's arguments or the position of a context a node opened, innermost first.
bindings_json(B, Bs) :- maplist(binding_json, B, Bs).
binding_json(N-args(Pairs), _{node: N, args: Js}) :- !, maplist(argument_json, Pairs, Js).
binding_json(N-within(P), _{node: N, within: P}) :- !.
binding_json(N-M, _{node: N, member: M}).
argument_json(K-Val, _{name: K, value: Val}).

% n3_export(+Namespace, +Top, -Text): a line's proof as N3: each proved call as a fact, and each node as the rules of its
% reading over its parts. An activity stays out of the rules, so a node that proves its statements again (ensure, a waypoint
% and until) exports the parts of its last proof, and whenever exports its actions and the negation of its last condition.
n3_export(Ns, Top, Text) :- findall(L, n3_line(Ns, Top, L), Ls), atomic_list_concat(Ls, '\n', Text).

n3_line(Ns, T, L) :- part(T, P, _, call(proved)), n3_triple(Ns, P, L).
n3_line(Ns, T, L) :- part(T, P, _, node(F, _)), children(T, P, Cs), n3_reading(F, Cs, Body), n3_rule(Ns, Body, P, L).

% children(+Top, +Path, -Children): each part directly under Path as Group-Position, in the order of their positions.
children(T, P, Cs) :- findall(N-(G-C), ( part(T, C, G, _), append(P, [N], C) ), Keyed), keysort(Keyed, Sorted), pairs_values(Sorted, Cs).

% n3_reading(+Reading, +Children, -Body): the conditions of each rule a node's reading exports, one solution per rule.
n3_reading(not, Cs, [notIncludes(Ps)]) :- !, in_group(_, Cs, Ps).
n3_reading(maybe, _, []) :- !.
n3_reading(where, Cs, Body) :- !, in_group(condition(_), Cs, Conds), in_group(action(_), Cs, Acts), ( Body = [notIncludes(Conds)] ; append(Conds, Acts, Body) ).
n3_reading(F, Cs, [C]) :- memberchk(F, [any_of, some]), !, member(_-C, Cs).
n3_reading(F, Cs, Ps) :- memberchk(F, [apply, until]), !, last_group(proof, Cs, G), in_group(G, Cs, Ps).
n3_reading(whenever, Cs, [notIncludes(Conds)|Acts]) :- !, last_group(condition, Cs, G), in_group(G, Cs, Conds), in_group(action(_), Cs, Acts).
n3_reading(_, Cs, Ps) :- in_group(_, Cs, Ps).

in_group(G, Cs, Ps) :- findall(C, member(G-C, Cs), Ps).
last_group(K, Cs, G) :- findall(I, ( member(G0-_, Cs), G0 =.. [K, I] ), Is), ( max_list(Is, Max) -> G =.. [K, Max] ; G = none ).

n3_triple(Ns, P, T) :- atomic_list_concat([p|P], '_', A), format(atom(T), '<~w~w> <~wis> <~wproved>.', [Ns, A, Ns, Ns]).
n3_rule(Ns, Body, P, L) :- maplist(n3_condition(Ns), Body, Ss), atomic_list_concat(Ss, ' ', B), n3_triple(Ns, P, H), format(atom(L), '{ ~w } => { ~w }.', [B, H]).
n3_condition(Ns, notIncludes(Cs), S) :- !, maplist(n3_triple(Ns), Cs, Ts), atomic_list_concat(Ts, ' ', Inner), format(atom(S), '?scope <http://www.w3.org/2000/10/swap/log#notIncludes> { ~w }.', [Inner]).
n3_condition(Ns, C, S) :- n3_triple(Ns, C, S).
