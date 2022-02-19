#!/bin/sh

## FIXME spent a day trying to get lerna set up properly. Deno, save me.

cd modules &&

## self contained
(for i in core; do
  cd $i
  npm i && \
  tsc -b . && 
  echo "setup link for $i" && \
  npm link && \
  cd ../
done) && \

## depends on @haibun/core

(for i in out-xunit parse-md; do
  cd $i
  npm i &&  \
  npm link @haibun/core && \
  tsc -b . &&  \
  echo "\nsetup link for $i" && \
  cd ../
done) &&  \

## depends on @haibun/core and needs to be linked

(for i in web-http; do
  cd $i
  npm i &&  \
  npm link @haibun/core && \
  tsc -b . &&  \
  echo "\nsetup link for $i" && \
  npm link &&  \
  cd ../
done) &&  \

## depends on @haibun/core and web-http and needs to be linked

(for i in web-server-express; do
  cd $i
  npm i &&  \
  npm link @haibun/core @haibun/web-http && \
  tsc -b . &&  \
  echo "\nsetup link for $i" && \
  npm link &&  \
  cd ../
done) &&  \


## depends on @haibun/core and web-server-express

(for i in logger-websockets domain-webpage domain-storage; do
  cd $i
  npm i &&  \
  npm link @haibun/core @haibun/web-server-express && \
  tsc -b . &&  \
  echo "\nsetup link for $i" && \
  npm link &&  \
  cd ../
done) &&  \

## depends on @haibun/core and @haibun/domain-webpage
(for i in web-playwright; do
  cd $i
  npm i &&  \
  npm link @haibun/core @haibun/domain-webpage && \
  tsc -b . &&  \

  echo "\nsetup link for $i" && \
  npm link &&  \
  cd ../
done) &&  \

## depends on @haibun/core and @haibun/domain-storage
(for i in storage-fs; do
  cd $i
  npm i &&  \
  npm link @haibun/core @haibun/domain-storage && \
  tsc -b . &&  \

  echo "\nsetup link for $i" && \
  npm link &&  \
  cd ../
done) &&  \

## depends on @haibun/core and @haibun/domain-storage
(for i in out-review; do
  cd $i
  npm i &&  \
  npm link @haibun/core @haibun/domain-storage @haibun/storage-fs && \
  tsc -b . &&  \

  echo "\nsetup link for $i" && \
  npm link &&  \
  cd ../
done) &&  \

# depends on many
(for i in cli; do 
  cd $i ; echo "\nlinking $i" ;

  npm link @haibun/core @haibun/web-playwright @haibun/web-http @haibun/web-server-express && \
  tsc -b . && \
  npm link && \

  cd ../
done) 
cd ..

