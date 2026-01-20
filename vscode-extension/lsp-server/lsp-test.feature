## Semantic Highlighting Overview
;; This file demonstrates how Haibun steps are mapped to VS Code semantic tokens.

set x to 1
;; Basic Step: Mapped to 'function' color. tokens: function

click x by placeholder
;; Parameterized Step: Step words are 'function', arguments are 'parameter'. tokens: function (click, by placeholder), parameter (x)

click {target: string | page-locator} by method 
;; Type Hints: Parameters with type definitions are also mapped as 'parameter'. tokens: function (click, by method), parameter ({target...})

variable x exists
;; Compound Step: 'variable' and 'exists' are recognized. tokens: function (variable, exists), parameter (x)

not variable x exists 
;; Recursive Highlighting: 'not' is a step. Inner 'variable x exists' is colored as a step. tokens: function (not), function (variable exists), parameter (x)

not variable what 
;; Resolution Fallback: 'not' is a step, 'variable what' is INVALID so it falls back to 'parameter' color. tokens: function (not), parameter (variable what)

aosdfisodfda
;; Error: Unresolved line. Marked with a red squiggly. no tokens => Diagnostic Error

## Waypoint testing
;; Markdown Header: prose, not highlighted as code. no tokens

Feature: mesbit
;; Keyword: 'Feature' is a Gherkin keyword. token: comment (Prose/Keyword)

This is prose.
;; Prose: Unrecognized text starting with Uppercase is treated as comment/prose. token: comment

Did foobar
;; Waypoint: dynamic step resolving to an Activity. Mapped to 'function'. token: function

ensure Ensured foobar
;; Assertion: 'ensure' is a step. 'Ensured foobar' is the valid inner step being checked. tokens: function (ensure), function (Ensured foobar - recursive)

ensure Did foobar
;; Logical Error: 'Did foobar' is a valid step but has no proof/result to ensure. Shows as error. tokens: function (ensure), parameter (Did foobar - failed verification) => Diagnostic Error

ensure Does not exist
;; Missing Reference: 'Does not exist' is not a known step. Shows as error. tokens: function (ensure), parameter (Does not exist - fallback) => Diagnostic Error

