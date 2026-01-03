Activity: foobar
;; Function Definition: Defines a reusable background sequence. token: comment (Prose/Keyword)

set x to "ya"
;; Parameterized Step: Step words are 'function', arguments are 'parameter'. tokens: function (set, to), parameter (x, ya)

waypoint Did foobar
;; Waypoint Call: Resolves to an Activity. token: function

waypoint Ensured foobar with variable x exists
;; Parameterized Waypoint: Resolves to Activity with argument. tokens: function (waypoint, with variable, exists), parameter (Ensured foobar, x)