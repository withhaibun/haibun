% The logic engine's program. Each line of a feature is one query. attempt/3 evaluates the line's term against the
% effects recorded so far for that line, and throws need/3 where the proof reaches an effect without its outcome: a
% built-in call, a record's opening or closing, a quantifier's members, a waypoint's arguments or rule, or a wait.
% The pipeline performs the effect, records its outcome with record/4, and runs the query again, so a query never holds
% the runtime across an await and the proofs of several callers interleave at each effect.
%
% A verdict is proved, refuted, unknown or contradiction. A built-in that passed is proved, one that failed is refuted,
% and one that couldn't run is unknown. Negation is negation as failure scoped to the results of its line: effect/5
% reads only the outcomes recorded for the line's own query, so a negation doesn't read another line's or caller's results.
:- module(haibun, [attempt/3, record/4, forget/1, n3_export/3, max_depth/1]).
:- use_module(library(lists)).
:- use_module(library(apply)).

:- dynamic result/5, counter/4.

% key(+Top, +Kind, +Path, -Key): the hash a recorded outcome and a position's counter are indexed by, so a query reads each
% in constant time however many outcomes its line recorded.
key(T, K, P, Key) :- term_hash(t(T, K, P), Key).

% within proves its statements inside the context its node opened, which each call below it reads from its bindings.
% One bound holds every proof: the depth of nested readings, the repetitions of whenever and until, and a waypoint's
% recursion below the ancestor check.
max_depth(1000).

% attempt(+Top, +TermText, -Outcome): Outcome is done(Verdict, ProofJson) or need(Kind, Path, RequestJson).
attempt(Top, TermText, Outcome) :-
    term_string(Term, TermText),
    retractall(counter(_, Top, _, _)),
    catch(( ev(Top, Term, [], [], [], 0, V, Proof), proof_json(Proof, J), term_to_atom(Proof, PT), Outcome = _{verdict: V, proof: J, term: PT} ),
          need(K, Path, R),
          ( request_json(R, RJ), kind_text(K, KT), Outcome = _{need: KT, path: Path, request: RJ} )).

% record(+Top, +KindText, +Path, +OutcomeText): the outcome of an effect at Path of the line Top.
record(Top, KindText, Path, OutcomeText) :- term_string(K, KindText), term_string(O, OutcomeText), key(Top, K, Path, Key), assertz(result(Key, Top, K, Path, O)).

% forget(+Top): removes the outcomes of a line whose proof completed.
forget(Top) :- retractall(result(_, Top, _, _, _)), retractall(counter(_, Top, _, _)).

effect(T, K, P, R, O) :- key(T, K, P, Key), ( result(Key, T, K, P, O0) -> O = O0 ; throw(need(K, P, R)) ).

% child(+Top, +Path, -Child): the next position under Path. Positions restart with each attempt, so a proof evaluated
% again takes the same paths.
child(T, P, C) :- key(T, child, P, Key), ( retract(counter(Key, T, P, N0)) -> N is N0 + 1 ; N = 1 ), assertz(counter(Key, T, P, N)), append(P, [N], C).

outcome_verdict(passed, proved).
outcome_verdict(failed, refuted).
outcome_verdict(refused, unknown).

naf(proved, refuted).
naf(refuted, proved).
naf(unknown, proved).
naf(contradiction, contradiction).

% worse(+Held, +Found, -Kept): a disjunction or a search without a proof is unknown where any part is unknown.
worse(unknown, _, unknown) :- !.
worse(_, unknown, unknown) :- !.
worse(W, _, W).

% ev(+Top, +Term, +Path, +Bindings, +Ancestors, +Depth, -Verdict, -Proof)
ev(T, call(N), P, B, _, _, V, call(N, P, V)) :- !, effect(T, call, P, call(N, B), O), outcome_verdict(O, V).
ev(T, apply(M, W), P, B, A, D, V, Proof) :- !, applied(T, run, M, W, P, B, A, D, V, Proof).
ev(T, Term, P, B, A, D, V, node(N, F, P, V, Ps)) :-
    Term =.. [F, N | Args],
    effect(T, open, P, open(N, B), Opened),
    (   Opened == refused -> V = unknown, Ps = [reason(refused)]
    ;   D1 is D + 1, max_depth(Max),
        ( D1 > Max -> V = unknown, Ps = [reason(depth(Max))] ; reading(F, N, Args, T, P, B, A, D1, V, Ps) ),
        decided(Ps, V, Why),
        effect(T, close, P, close(N, V, Why), _)
    ).

% decided(+Proofs, +Verdict, -Why): the part of a proof that decided a verdict other than proved, as its path or a reason.
decided(_, proved, none) :- !.
decided(Ps, _, Why) :- reverse(Ps, Rs), ( member(R, Rs), unmet(R, Why) -> true ; Why = none ).
unmet(call(_, P, V), P) :- V \== proved.
unmet(node(_, _, P, V, _), P) :- V \== proved.
unmet(group(_, Ps), Why) :- decided(Ps, refuted, Why), Why \== none.
unmet(reason(R), R).

conj(_, [], _, _, _, _, proved, []).
conj(T, [X|Xs], P, B, A, D, V, [Pr|Prs]) :-
    child(T, P, C), ev(T, X, C, B, A, D, V0, Pr),
    ( V0 == proved -> conj(T, Xs, P, B, A, D, V, Prs) ; V = V0, Prs = [] ).

reading(not, _, [Xs], T, P, B, A, D, V, Ps) :- conj(T, Xs, P, B, A, D, V0, Ps), naf(V0, V).
reading(where, _, [Cs, Xs], T, P, B, A, D, V, Ps) :-
    conj(T, Cs, P, B, A, D, VC, PC),
    ( VC == proved -> conj(T, Xs, P, B, A, D, V, PX), append(PC, PX, Ps) ; V = proved, Ps = PC ).
reading(any_of, _, [Alternatives], T, P, B, A, D, V, Ps) :- any(T, Alternatives, P, B, A, D, refuted, V, Ps).
reading(maybe, _, [Xs], T, P, B, A, D, proved, Ps) :- conj(T, Xs, P, B, A, D, _, Ps).
reading(waypoint, _, [], _, _, _, _, _, proved, []).
reading(waypoint, _, [Xs], T, P, B, A, D, V, Ps) :- conj(T, Xs, P, B, A, D, V, Ps).
reading(within, N, [Xs], T, P, B, A, D, V, Ps) :- conj(T, Xs, P, [N-within(P)|B], A, D, V, Ps).
reading(some, N, [Xs], T, P, B, A, D, V, Ps) :-
    members(T, N, P, B, Found),
    (   Found = members([]) -> V = refuted, Ps = [reason(empty)]
    ;   Found = members(Ms) -> exists(T, N, Ms, Xs, P, B, A, D, refuted, V, Ps)
    ;   V = unknown, Ps = [reason(Found)]
    ).
reading(every, N, [Xs], T, P, B, A, D, V, Ps) :-
    members(T, N, P, B, Found),
    ( Found = members(Ms) -> for_all(T, N, Ms, Xs, P, B, A, D, V, Ps) ; V = unknown, Ps = [reason(Found)] ).
reading(whenever, _, [Cs, Xs], T, P, B, A, D, V, Ps) :- repeat_while(T, Cs, Xs, P, B, A, D, 1, V, Ps).
reading(until, N, [Xs], T, P, B, A, D, V, Ps) :- attempts(T, N, Xs, P, B, A, D, 1, V, Ps).
reading(ensure, _, [[apply(M, W)]], T, P, B, A, D, V, [Pr]) :- !, child(T, P, C), applied(T, ensure, M, W, C, B, A, D, V, Pr).
reading(ensure, _, [_], _, _, _, _, _, refuted, [reason(not_waypoint)]).

any(_, [], _, _, _, _, W, W, []).
any(T, [Xs|Rest], P, B, A, D, W, V, Ps) :-
    conj(T, Xs, P, B, A, D, V0, P0),
    ( V0 == proved -> V = proved, Ps = P0 ; worse(W, V0, W1), any(T, Rest, P, B, A, D, W1, V, P1), append(P0, P1, Ps) ).

members(T, N, P, B, Found) :- effect(T, members, P, members(N, B), Found).

exists(_, _, [], _, _, _, _, _, W, W, []).
exists(T, N, [M|Ms], Xs, P, B, A, D, W, V, Ps) :-
    conj(T, Xs, P, [N-M|B], A, D, V0, P0),
    ( V0 == proved -> V = proved, Ps = P0 ; worse(W, V0, W1), exists(T, N, Ms, Xs, P, B, A, D, W1, V, P1), append(P0, P1, Ps) ).

for_all(_, _, [], _, _, _, _, _, proved, []).
for_all(T, N, [M|Ms], Xs, P, B, A, D, V, Ps) :-
    conj(T, Xs, P, [N-M|B], A, D, V0, P0),
    ( V0 == proved -> for_all(T, N, Ms, Xs, P, B, A, D, V, P1), append(P0, P1, Ps) ; V = V0, Ps = P0 ).

% whenever: repeat the action while the condition holds, within the bound.
repeat_while(T, Cs, Xs, P, B, A, D, K, V, Ps) :-
    max_depth(Max),
    (   K > Max -> V = unknown, Ps = [reason(depth(Max))]
    ;   conj(T, Cs, P, B, A, D, VC, PC),
        (   VC == proved ->
            conj(T, Xs, P, B, A, D, VX, PX),
            (   VX == proved -> K1 is K + 1, repeat_while(T, Cs, Xs, P, B, A, D, K1, V, PR), Ps = [group(condition, PC), group(action, PX)|PR]
            ;   V = VX, Ps = [group(condition, PC), group(action, PX)]
            )
        ;   V = proved, Ps = [group(condition, PC)]
        )
    ).

% until: prove the statements again after each wait, until they hold or the wait reports the deadline passed.
attempts(T, N, Xs, P, B, A, D, K, V, Ps) :-
    conj(T, Xs, P, B, A, D, V0, P0),
    (   V0 == proved -> V = proved, Ps = [group(proof, P0)]
    ;   max_depth(Max), K >= Max -> V = unknown, Ps = [group(proof, P0), reason(depth(Max))]
    ;   effect(T, wait(K), P, wait(N, K), Waited),
        ( Waited == again -> K1 is K + 1, attempts(T, N, Xs, P, B, A, D, K1, V, P1), Ps = [group(proof, P0)|P1] ; V = V0, Ps = [group(proof, P0), reason(expired)] )
    ).

% A waypoint's rule: its head holds where its proof holds, and its activity is the plan that makes the proof hold. ensure
% reads P ∨ (¬P ∧ [A]P), and a waypoint line run alone reads P ∨ [A]. The ancestor check refuses a rule applied again
% with the same arguments below itself.
applied(T, Mode, M, W, P, B, A, D, V, node(M, apply, P, V, Ps)) :-
    effect(T, open, P, open(M, B), Opened),
    (   Opened == refused -> V = unknown, Ps = [reason(refused)]
    ;   effect(T, args, P, args(M, B), Args),
        (   Args = args(Pairs) ->
            effect(T, rule, P, rule(W), rule(Proof, Activity)),
            Key = W-Pairs,
            (   memberchk(Key, A) -> V = unknown, Ps = [reason(cycle)]
            ;   D1 is D + 1, max_depth(Max),
                ( D1 > Max -> V = unknown, Ps = [reason(depth(Max))] ; plan(Mode, T, Proof, Activity, P, [M-args(Pairs)|B], [Key|A], D1, V, Ps) )
            )
        ;   V = unknown, Ps = [reason(Args)]
        ),
        decided(Ps, V, Why),
        effect(T, close, P, close(M, V, Why), _)
    ).

plan(ensure, _, [], _, _, _, _, _, refuted, [reason(no_proof)]) :- !.
plan(ensure, T, Proof, Activity, P, B, A, D, V, Ps) :-
    conj(T, Proof, P, B, A, D, V0, P0),
    (   V0 == proved -> V = proved, Ps = [group(proof, P0)]
    ;   conj(T, Activity, P, B, A, D, VA, PA),
        (   VA == proved -> conj(T, Proof, P, B, A, D, V, P1), Ps = [group(proof, P0), group(activity, PA), group(proof, P1)]
        ;   V = VA, Ps = [group(proof, P0), group(activity, PA)]
        )
    ).
plan(run, T, Proof, Activity, P, B, A, D, V, Ps) :-
    ( Proof == [] -> V0 = refuted, P0 = [] ; conj(T, Proof, P, B, A, D, V0, P0) ),
    (   V0 == proved -> V = proved, Ps = [group(proof, P0)]
    ;   Activity == [] -> ( Proof == [] -> V = proved ; V = V0 ), Ps = [group(proof, P0)]
    ;   conj(T, Activity, P, B, A, D, V, PA), Ps = [group(proof, P0), group(activity, PA)]
    ).

% Proofs, requests and kinds as JSON-ready dicts.
proof_json(call(N, P, V), _{node: N, path: P, verdict: V}).
proof_json(node(N, F, P, V, Ps), _{node: N, reading: F, path: P, verdict: V, parts: Js}) :- maplist(proof_json, Ps, Js).
proof_json(group(K, Ps), _{group: K, parts: Js}) :- maplist(proof_json, Ps, Js).
proof_json(reason(R), _{reason: Text}) :- term_to_atom(R, Text).

request_json(call(N, B), _{node: N, bindings: Bs}) :- bindings_json(B, Bs).
request_json(open(N, B), _{node: N, bindings: Bs}) :- bindings_json(B, Bs).
request_json(members(N, B), _{node: N, bindings: Bs}) :- bindings_json(B, Bs).
request_json(args(N, B), _{node: N, bindings: Bs}) :- bindings_json(B, Bs).
request_json(close(N, V, Why), _{node: N, verdict: V, why: W}) :- ( is_list(Why) -> W = Why ; term_to_atom(Why, W) ).
request_json(rule(W), _{rule: W}).
request_json(wait(N, K), _{node: N, attempt: K}).

% A binding is a quantifier's member, a waypoint's arguments or the position of a context a node opened, innermost first.
bindings_json(B, Bs) :- maplist(binding_json, B, Bs).
binding_json(N-args(Pairs), _{node: N, args: Js}) :- !, maplist(argument_json, Pairs, Js).
binding_json(N-within(P), _{node: N, within: P}) :- !.
binding_json(N-M, _{node: N, member: M}).
argument_json(K-Val, _{name: K, value: Val}).

kind_text(K, Text) :- term_to_atom(K, Text).

% n3_export(+Namespace, +ProofText, -Text): a line's proof as N3: each proved call as a fact, and each node as the rules
% of its reading over its parts. An activity stays out of the rules, so a node that repeats its proof (ensure, a waypoint
% and until) exports the parts of its last proof, and whenever exports its actions and the negation of its last condition.
n3_export(Ns, ProofText, Text) :-
    term_string(Proof, ProofText),
    phrase(n3_proof(Ns, Proof), Lines),
    atomic_list_concat(Lines, '\n', Text).

n3_proof(Ns, call(_, P, proved)) --> !, { n3_holds(Ns, P, L) }, [L].
n3_proof(_, call(_, _, _)) --> [].
n3_proof(_, reason(_)) --> [].
n3_proof(Ns, group(_, Ps)) --> n3_parts(Ns, Ps).
n3_proof(Ns, node(_, F, P, _, Ps)) --> n3_parts(Ns, Ps), n3_reading(F, Ns, P, Ps).
n3_parts(_, []) --> [].
n3_parts(Ns, [X|Xs]) --> n3_proof(Ns, X), n3_parts(Ns, Xs).

n3_reading(not, Ns, P, Ps) --> !, { paths(Ps, Cs), n3_rule(Ns, [notIncludes(Cs)], P, L) }, [L].
n3_reading(maybe, Ns, P, _) --> !, { n3_rule(Ns, [], P, L) }, [L].
n3_reading(where, Ns, P, [C|Xs]) --> !, { paths([C], Cs), paths(Xs, Ds), n3_rule(Ns, [notIncludes(Cs)], P, L1), append(Cs, Ds, All), n3_rule(Ns, All, P, L2) }, [L1, L2].
n3_reading(F, Ns, P, Ps) --> { memberchk(F, [any_of, some]) }, !, n3_each(Ns, P, Ps).
n3_reading(F, Ns, P, Ps) --> { memberchk(F, [apply, until]) }, !, { last_group(proof, Ps, Last), paths(Last, Cs), n3_rule(Ns, Cs, P, L) }, [L].
n3_reading(ensure, Ns, P, [Applied]) --> !, { paths([Applied], Cs), n3_rule(Ns, Cs, P, L) }, [L].
n3_reading(whenever, Ns, P, Ps) --> !, { last_group(condition, Ps, Last), paths(Last, Cs), findall(G, member(group(action, G), Ps), Gs), append(Gs, Xs), paths(Xs, Ds), n3_rule(Ns, [notIncludes(Cs)|Ds], P, L) }, [L].
n3_reading(_, Ns, P, Ps) --> { paths(Ps, Cs), n3_rule(Ns, Cs, P, L) }, [L].
n3_each(_, _, []) --> [].
n3_each(Ns, P, [X|Xs]) --> { paths([X], Cs), n3_rule(Ns, Cs, P, L) }, [L], n3_each(Ns, P, Xs).

last_group(K, Ps, Last) :- findall(G, member(group(K, G), Ps), Gs), ( last(Gs, Last) -> true ; Last = [] ).
paths(Ps, Cs) :- findall(C, ( member(X, Ps), part_path(X, C) ), Cs).
part_path(call(_, C, _), C).
part_path(node(_, _, C, _, _), C).

n3_holds(Ns, P, L) :- n3_triple(Ns, P, T), format(atom(L), '~w', [T]).
n3_triple(Ns, P, T) :- atomic_list_concat([p|P], '_', A), format(atom(T), '<~w~w> <~wis> <~wproved>.', [Ns, A, Ns, Ns]).
n3_rule(Ns, Body, P, L) :-
    maplist(n3_condition(Ns), Body, Ss), atomic_list_concat(Ss, ' ', B), n3_triple(Ns, P, H),
    format(atom(L), '{ ~w } => { ~w }.', [B, H]).
n3_condition(Ns, notIncludes(Cs), S) :- !, maplist(n3_triple(Ns), Cs, Ts), atomic_list_concat(Ts, ' ', Inner), format(atom(S), '?scope <http://www.w3.org/2000/10/swap/log#notIncludes> { ~w }.', [Inner]).
n3_condition(Ns, C, S) :- n3_triple(Ns, C, S).
