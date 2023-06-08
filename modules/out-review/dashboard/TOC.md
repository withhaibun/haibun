# prairie-json-explorer

An HTML5 page that queries a location for an index of JSON files which will be used to create a list of links. 
Any file called "latest-pr.json" should use a "link" field for a link to the latest deployed PR, and a "title" field for the title of the PR.
Any file that starts with "review-" should use the "link" and "title" fields to be added to a list of e2e test reviews links.
If there are no PR or review files, the page should display a message saying there are no files of that type.


gpt-4
Generated on 2023-06-07T17:15:23.912Z

* Haibot's Haibun scenario phrases for the prairie-json-explorer application: [gen/prairie-json-explorer/haibun/prairie_json_explorer.feature](haibun/gen/prairie-json-explorer/haibun/prairie_json_explorer.feature), [gen/prairie-json-explorer/haibun/placeholders.feature](haibun/gen/prairie-json-explorer/haibun/placeholders.feature)
* Create an HTML5 page with TypeScript libraries for data access and service requests, using Frameworkless Web Components and ARIA attributes for accessibility: [gen/prairie-json-explorer/web/package.json](web/gen/prairie-json-explorer/web/package.json), [gen/prairie-json-explorer/web/server.js](web/gen/prairie-json-explorer/web/server.js), [gen/prairie-json-explorer/web/tsconfig.json](web/gen/prairie-json-explorer/web/tsconfig.json), [gen/prairie-json-explorer/web/public/index.html](web/gen/prairie-json-explorer/web/public/index.html), [gen/prairie-json-explorer/web/public/main.css](web/gen/prairie-json-explorer/web/public/main.css), [gen/prairie-json-explorer/web/src/prairie-json-explorer.ts](web/gen/prairie-json-explorer/web/src/prairie-json-explorer.ts), [gen/prairie-json-explorer/web/src/lib/data-access.ts](web/gen/prairie-json-explorer/web/src/lib/data-access.ts), [gen/prairie-json-explorer/web/src/bundle.ts](web/gen/prairie-json-explorer/web/src/bundle.ts)