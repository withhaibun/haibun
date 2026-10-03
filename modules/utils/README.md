# Scaffolding

You can scaffold Haibun into an existing or new project using `npx -p @haibun/utils scaffold`.
This will add the core library, Typescript and unit test support (if missing),
steppers, a placeholder library, and tests.
It won't overwrite existing files. It presumes a `src` folder for source files.

# Virtual capture

Audio/video virtualized captures (vcapture) can be added to projects using the `run-vcapture` command
with the following options:

This feature requires Docker Compose to be installed on the host system.

## Parameters
`run-vcapture [options] script folder ...` runs the package.json script `script` in a container.
Each `folder` is mounted in the container, as the folders that hold the features and the files they read.
`run-vcapture --help` lists the options.

## Options

`--recreate`: Re-create the container

`--tts`: uses local Kokoro text-to-speech
Any prose lines in the tests, along with headings like "Scenario" will be spoken (using kokoro-tts).

`--pass-env`: environment variables to pass through. use multiple --pass-env for multiple values, for example, `--pass-env=HAIBUN_STAY=failure --pass-env=HAIBUN_LOG_LEVEL=log`

`--cli-env`: HAIBUN_ENV variables to pass through, for example, `--cli-env=USERNAME=foo,PASSWORD=bar`

Runtime options should be passed to package.json script commands using `-- --option`

`--feature-filter`: filter for tests to run

`--res`: Resolution for virtual desktop

`--no-capture`: Don't record the session




