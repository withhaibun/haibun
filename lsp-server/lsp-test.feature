lsp is ready
;; good, available statement

click x by placeholder
;; correct
click {target: string | page-locator} by method 
;; correct; click and by are steps, target and method are parameters

variable x exists
not variable x exists 
;; compound second statement highlighted same as single

not variable what 
;; second element of compound statement is not a step so should be an error

aosdfisodfda
;; good; shows as error and is in problems

## Waypoint testing
;; this is prose (semantically a comment)

Feature: mesbit
;; this is feature (semantically a comment)

This is prose.
;; this is prose (semantically a comment)

Did foobar
;; this calls a waypoint, semantically a function or method.

ensure Ensured foobar
;; ensure is  step but Ensured foobar is sematically a function or method.
ensure Did foobar
;; This is an error because Did foobar does not have a proof.

ensure Does not exist
;; an error because the waypoint does not exist

