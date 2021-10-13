#!/bin/sh -x

## FIXME spent a day trying to get lerna set up properly. Deno, save me.

cd modules &&
(for i in core ; do
  cd $i
  npm i &&  \
  tsc -b . && \ 
  echo "\nsetup link for $i" && \
  npm link &&  \
  cd ../
done) &&  \

(for i in web-playwright web-http web-server-express out-xunit; do
  cd $i
  npm i &&  \
  npm link @haibun/core && \
  tsc -b . &&  \
  echo "\nsetup link for $i" && \
  npm link &&  \
  cd ../
done) &&  \

(for i in client-playwright frontend parse-md; do
  cd $i;
  echo "\nlink $i"
  npm link @haibun/core && \
  tsc -b . && \
  cd ..;
done) && \

cd cli ; echo "\nlinking cli" ;
npm link @haibun/core @haibun/web-playwright @haibun/web-http @haibun/web-server-express && \
tsc -b . && \
npm link && \

cd ../..



