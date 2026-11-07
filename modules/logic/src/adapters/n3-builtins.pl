% The N3 built-ins the translated clauses call (n3-translation.pl), over EYE's term forms: an IRI as '<iri>', a literal as
% literal(Text, type(Datatype)) or literal(Text, lang(L)), a number as itself, a list as a list. Each expects its inputs bound,
% which the order of a translated body arranges.
:- module(n3_builtins, []).
:- discontiguous(text/2).
:- use_module(library(lists)).
:- use_module(library(apply)).
:- use_module(library(pcre)).
:- use_module(library(date)).
:- use_module(library(yall)).
xsd_string('<http://www.w3.org/2001/XMLSchema#string>').
% EYE holds a literal's text as N3 writes it, escapes included; a built-in reads the text unescaped and writes its result escaped.
text(literal(E, _), T) :- !, unescaped(E, T).
unescaped(E, T) :- ( sub_atom(E, _, _, _, '\\') -> atom_codes(E, Cs), unesc(Cs, Us), atom_codes(T, Us) ; T = E ).
unesc([], []).
unesc([0'\\, C|Cs], [U|Us]) :- !, esc(C, U), unesc(Cs, Us).
unesc([C|Cs], [C|Us]) :- unesc(Cs, Us).
esc(0'n, 0'\n) :- !.
esc(0't, 0'\t) :- !.
esc(0'r, 0'\r) :- !.
esc(C, C).
escaped(T, E) :- ( (sub_atom(T, _, _, _, '\\') ; sub_atom(T, _, _, _, '"')) -> atom_codes(T, Cs), foldl([C, A0, A]>>((C == 0'\\ ; C == 0'") -> append(A0, [0'\\, C], A) ; append(A0, [C], A)), Cs, [], Es), atom_codes(E, Es) ; E = T ).
text(N, T) :- number(N), !, atom_number(T, N).
text(A, T) :- atom(A), atom_concat('<', R, A), atom_concat(T, '>', R), !.
text(A, A).
str(T, literal(E, type(S))) :- xsd_string(S), escaped(T, E).
num(N, N) :- number(N), !.
num(literal(T, type('<http://www.w3.org/2001/XMLSchema#dateTime>')), N) :- !, parse_time(T, iso_8601, N).
num(literal(T, type('<http://www.w3.org/2001/XMLSchema#date>')), N) :- !, parse_time(T, iso_8601, N).
num(literal(T, _), N) :- atom_number(T, N).
'<http://www.w3.org/2000/10/swap/log#equalTo>'(A, A).
'<http://www.w3.org/2000/10/swap/log#notEqualTo>'(A, B) :- A \= B.
'<http://www.w3.org/2000/10/swap/string#startsWith>'(A, B) :- text(A, X), text(B, Y), sub_atom(X, 0, _, _, Y), !.
'<http://www.w3.org/2000/10/swap/string#endsWith>'(A, B) :- text(A, X), text(B, Y), sub_atom(X, _, _, 0, Y), !.
'<http://www.w3.org/2000/10/swap/string#contains>'(A, B) :- text(A, X), text(B, Y), sub_atom(X, _, _, _, Y), !.
'<http://www.w3.org/2000/10/swap/string#concatenation>'(L, R) :- maplist(text, L, Ts), atomic_list_concat(Ts, C), str(C, R).
'<http://www.w3.org/2000/10/swap/string#scrape>'([A, P], R) :- text(A, X), text(P, Re), re_matchsub(Re, X, Sub, []), get_dict(1, Sub, S), atom_string(C, S), str(C, R).
'<http://www.w3.org/2000/10/swap/math#greaterThan>'(A, B) :- num(A, X), num(B, Y), X > Y.
'<http://www.w3.org/2000/10/swap/math#lessThan>'(A, B) :- num(A, X), num(B, Y), X < Y.
'<http://www.w3.org/2000/10/swap/math#notLessThan>'(A, B) :- num(A, X), num(B, Y), X >= Y.
'<http://www.w3.org/2000/10/swap/math#notGreaterThan>'(A, B) :- num(A, X), num(B, Y), X =< Y.
'<http://www.w3.org/2000/10/swap/math#sum>'(L, S) :- maplist(num, L, Ns), sum_list(Ns, S).
'<http://www.w3.org/2000/10/swap/list#member>'(L, X) :- member(X, L).
'<http://www.w3.org/2000/10/swap/list#in>'(X, L) :- member(X, L).
'<http://www.w3.org/2000/10/swap/list#notMember>'(L, X) :- \+ memberchk(X, L).
'<http://www.w3.org/2000/10/swap/list#first>'([X|_], X).
'<http://www.w3.org/2000/10/swap/list#rest>'([_|R], R).
'<http://www.w3.org/2000/10/swap/list#firstRest>'([F|R], [F, R]).
'<http://www.w3.org/2000/10/swap/list#append>'(Ls, L) :- append(Ls, L).
'<http://www.w3.org/2000/10/swap/list#length>'(L, N) :- length(L, N).

% n3_answers(+Module, -Text): the triples the translated query of Module selects, as N3, each once. A Skolem term the clauses
% made for an existential variable is a blank node labelled by the term's hash.
n3_answers(M, Text) :- findall(T, (M:answer(P, S, O), triple_text(S, P, O, T)), Ts0), sort(Ts0, Ts), atomic_list_concat(Ts, '\n', Text).
triple_text(S, P, O, T) :- n3_text(S, ST), n3_text(P, PT), n3_text(O, OT), format(atom(T), '~w ~w ~w .', [ST, PT, OT]).
n3_text(A, A) :- atom(A), ( sub_atom(A, 0, 1, _, '<') ; sub_atom(A, 0, 2, _, '_:') ), !.
n3_text(literal(E, type(D)), T) :- !, format(atom(T), '"~w"^^~w', [E, D]).
n3_text(literal(E, lang(L)), T) :- !, format(atom(T), '"~w"@~w', [E, L]).
n3_text(N, T) :- number(N), !, format(atom(T), '~w', [N]).
n3_text(B, B) :- ( B == true ; B == false ), !.
n3_text(L, T) :- is_list(L), !, maplist(n3_text, L, Ts), atomic_list_concat(Ts, ' ', J), format(atom(T), '(~w)', [J]).
n3_text(Skolem, T) :- compound(Skolem), term_hash(Skolem, H), format(atom(T), '_:sk~w', [H]).
