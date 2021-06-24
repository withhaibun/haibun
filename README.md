[![unit tests Actions Status](https://github.com/vid/haibun/workflows/unit-tests/badge.svg)](https://github.com/vid/haibun/actions)

# haibun



The design goal of specl (working name) is re-usable, flexible, and easy to maintain natural language BDD inspired tests,
that can be used in a variety of settings and contexts.

# Feature structure

```
project/
  features/
    test.feature
  backgrounds/
    setup.feature
      dependant/
      run.feature
```

On running tests, features at the project/ level are run. 

Features can use the directive `Backgrounds: <features>` or `Scenarios: <features>` which will prepend comma-separated named features from backgrounds/.
Background features from further 'down' their tree will include previous features.

So, if test.feature includes run.feature, that will includes setup.feature and run.feature before test.feature's steps.

Note that features/ (unlike backgrounds) will not include folder predecessors.

# Flags

Flags are passed via environment variables. Currently, these are supported:

`HAIBUN_OUTPUT=AsXUnit`:  Display XUnit format as the result

`HAIBUN_SPLIT_SHARED=var=value1,value2`: run several instances with shared values assigned

`PWDEBUG=1`: (web) Enable Playwright debugging

`HAIBUN_LOG_LEVEL`: debug, log, info, warn, none





