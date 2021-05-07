# specl


# Feature structure

project/
  test.feature
backgrounds/
  setup.feature
    dependant/
    run.feature

On running tests, features at the project/ level are run. 

Features can use the directive `use <feature>` which will prepend named features from backgrounds/.
Background features from further 'down' their tree will include previous features.

So, if test.feature `use`s run.feature, setup.feature and run.feature will be run before test.feature's steps.

Note that features (unlike backgrounds) will not include predecessors.



