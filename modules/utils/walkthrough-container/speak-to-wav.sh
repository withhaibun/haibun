#!/usr/bin/sh

set -e

(if [ ! -d "node_modules/kokoro-js" ]; then
		echo "kokoro-js not found, installing..."
		npm install --no-save kokoro-js
fi) > install-kokoro.log 2>&1

node ./kokoro-speak.cjs output.wav "$*"; echo `pwd`/output.wav
