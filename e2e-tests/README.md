
## End to end tests for Haibun

Make sure the main project is built with `npm run build`.

use eg `npm run test -- --with-steppers=@haibun/monitor-tui ` to see test results (a filter can be passed as the last parameter, eg agent)

To access the cli / debugger, start the dev server using `npm run build-watch`, then use `npm run cli -- --with-steppers=@haibun/monitor-tui` to use the cli via the TUI.
