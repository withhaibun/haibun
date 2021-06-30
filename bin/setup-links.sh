#!/bin/sh

## FIXME spent a day trying to get lerna set up properly. Deno, save me.

cd modules &&
(for i in core web-playwright; do
  npm link 
  cd ../
done) && 

(for i in client-playwright frontend out-xunit parse-md server web-playwright; do
  cd $i;
  npm link @haibun/core;
  cd ..;
done) &&
cd cli &&
npm link @haibun/core @haibun/web-playwright &&

cd ../..



