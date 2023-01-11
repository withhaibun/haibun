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

(for i in web-http domain-webpage; do
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
  npm link @haibun/core @haibun/web-http @haibun/domain-webpage && \
  tsc -b . &&  \
  echo "\nsetup link for $i" && \
  npm link &&  \
  cd ../
done) &&  \


## depends on @haibun/core and web-server-express

(for i in logger-websockets domain-storage context; do
  cd $i
  npm i &&  \
  npm link @haibun/core @haibun/web-server-express && \
  tsc -b . &&  \
  echo "\nsetup link for $i" && \
  npm link &&  \
  cd ../
done) &&  \

## depends on @haibun/core and @haibun/domain-webpage @haibun/domain-storage
(for i in web-playwright; do
  cd $i
  npm i &&  \
  npm link @haibun/core @haibun/domain-webpage @haibun/domain-storage && \
  tsc -b . &&  \

  echo "\nsetup link for $i" && \
  npm link &&  \
  cd ../
done) &&  \

## depends on @haibun/core and @haibun/domain-webpage @haibun/context
(for i in feature-importer; do
  cd $i
  npm i &&  \
  npm link @haibun/core @haibun/domain-webpage @haibun/context && \
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
(for i in cli browser-extension; do 
  cd $i ; echo "\nlinking $i" ;
  npm i && \

  npm link @haibun/core @haibun/web-playwright @haibun/web-http @haibun/web-server-express @haibun/domain-storage && \
  tsc -b . && \
  npm link && \

  cd ../
done) 

(for i in feature-recorder; do 
  cd $i ; echo "\nlinking $i" ;
  npm i && \

  npm link @haibun/core @haibun/web-playwright @haibun/web-http @haibun/web-server-express @haibun/domain-storage @haibun/browser-extension @haibun/feature-importer && \
  tsc -b . && \
  npm link && \

  cd ../
done) 
cd ..

