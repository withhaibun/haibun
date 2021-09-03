#!/bin/sh -x

## FIXME spent a day trying to get lerna set up properly. Deno, save me.

cd modules &&
(for i in core web-playwright web-http web-server-express out-xunit web-component-builder logger-websockets; do
  cd $i && 
  echo "\nsetup link for $i"
  npm link  && 
  cd ../
done) && 

(for i in client-playwright web-http frontend out-xunit parse-md web-server-express logger-websockets; do
  cd $i && 
  echo "\nlink $i"
  npm link @haibun/core && 
  cd ..;
done) &&
cd cli ; echo "\nlinking cli" ;
npm link && npm link @haibun/core @haibun/web-playwright @haibun/web-http @haibun/web-server-express &&
cd web-playwright ; echo "\nlinking web-playwright" ;
npm link @haibun/core @haibun/web-component-builder

cd ../..



