
## Debugging steppers

A number of features are built in to help debugging steppers, which can be used in combination. For example:

`HAIBUN_O_WEBPLAYWRIGHT_HEADLESS=false HAIBUN_STAY=failure npm run test`

`HAIBUN_STAY=failure` will leave haibun and any current steppers running after execution.

Another technique, when debugging browser selectors,
is to try the selector in the browser console,
using the built-in `$x` xpath evaluator (Chrome browsers).

