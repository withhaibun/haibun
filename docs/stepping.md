
## Debugging steppers

A number of features are built in to help debugging steppers, which can be used in combination. For example:

`HAIBUN_TRACE=true HAIBUN_CLI=true HAIBUN_O_WEBPLAYWRIGHT_HEADLESS=false HAIBUN_STAY=failure npm run test`

will create trace files (by default, under 'capture'). 
`HAIBUN_STAY=failure` will leave haibun and any current steppers running after execution
in a cli, 
which can be used to inspect the environment. 
A default `haibun` context object is available.

Another technique, when debugging browser selectors, 
is to try the selector in the browser console, 
using the built-in `$x` xpath evaluator (Chrome browsers).

