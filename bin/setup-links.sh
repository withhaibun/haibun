#!/bin/sh -x

## FIXME spent a day trying to get lerna set up properly. Deno, save me.

cd modules &&

## self contained
(for i in core; do
  cd $i
  npm i &&  \
  tsc -b . && \ 
  echo "setup link for $i" && \
  npm link &&  \
  cd ../
done) &&  \

## depend on @haibun/core

(for i in domain-webpage web-http web-server-express out-xunit logger-websockets parse-md; do
  cd $i
  npm i &&  \
  npm link @haibun/core && \
  tsc -b . &&  \
  echo "\nsetup link for $i" && \
  npm link &&  \
  cd ../
done) &&  \

## depend on @haibun/core and @haibun/domain-webpage
(for i in web-playwright; do
  cd $i
  npm i &&  \
  npm link @haibun/core @haibun/domain-webpage && \
  tsc -b . &&  \

  echo "\nsetup link for $i" && \
  npm link &&  \
  cd ../
done) &&  \

(for i in  cli web-playwright; do 
cd $i ; echo "\nlinking $i" ;

npm link @haibun/core @haibun/web-playwright @haibun/web-http @haibun/web-server-express && \
tsc -b . && \
npm link && \

cd ../
done) 
cd ..

