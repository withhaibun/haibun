#!/usr/bin/sh

set -e
node ./kokoro-speak.cjs output.wav "$*"; echo `pwd`/output.wav
