
# Scaffolding

You can scaffold Haibun into an existing or new project using `npx -p @haibun/utils scaffold`.
This will add the core library, Typescript and unit test support (if missing),
steppers, a placeholder library, and tests.
It won't overwrite existing files. It presumes a `src` folder for source files.

# Walkthrough

Audio/video walkthroughs can be added to projects with the following package.json script:
`"walkthrough": "run-walkthrough-container <test-script> <filter> <folders>"`.

Any prose lines in the tests, along with headings like "Scenario" will be spoken (using kokoro-tts).

This feature requires Docker to be installed on the host system.

Where test-script is the package.json script to run for the script, filter is any filter ot use (or ""), and folders is folders that need to be mounted in the container to execute the tests (for example, `features files`).

`
