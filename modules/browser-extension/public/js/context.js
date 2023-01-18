(()=>{var e={893:(e,t,r)=>{"use strict";r.r(t),r.d(t,{ContextFeature:()=>n});class n{stored={};tags={};backgrounds={};currentPageTag=void 0;features=[];statements;getResult(){return{ok:!0,backgrounds:this.backgrounds,feature:this.features.join("\n")}}bq=(e,t,r=!1)=>this.vq(this.bg(e,t,r));vq=e=>"`"+e+"`";bg=(e,t,r=!1)=>{let n=this.stored[e]||0;this.stored[e]=++n;const o=`${e}${n}`;this.tags[o]=t,r&&(this.currentPageTag=o);const s={[o]:t};return this.currentPageTag&&(this.backgrounds[this.currentPageTag]=this.backgrounds[this.currentPageTag]?{...this.backgrounds[this.currentPageTag],...s}:s),o};controlToStatement(e){throw Error(`Unknown action ${e}`)}async eventToStatement(e){const{action:t}=e;throw"click"===t&&this.statements.push(`click ${this.vq(this.bg("Selector",e.selector))}`),Error(`Unknown action ${t}`)}contextToStatement(e){const{"@context":t,...r}=e;switch(t){case"#ambe/event":return this.eventToStatement(r);case"#ambe/control":return this.controlToStatement(r);default:throw Error("known context type")}}}},437:(e,t)=>{"use strict";Object.defineProperty(t,"__esModule",{value:!0}),t.WEB_SOCKET_SERVER=t.WebsocketPublisher=void 0,t.WebsocketPublisher=class{connect(){this.connection=new WebSocket("ws://localhost:3140")}async send(e){this.connection||this.connect(),this.connection?.send(JSON.stringify(e))}async close(){this.connection?.close()}},t.WEB_SOCKET_SERVER="WebSocketServer"},658:(e,t)=>{"use strict";Object.defineProperty(t,"__esModule",{value:!0}),t.BASE_TYPES=t.BASE_DOMAINS=t.DEFAULT_DEST=t.CAPTURE=t.BASE_PREFIX=t.HAIBUN=t.OK=t.AStepper=t.WorkspaceBuilder=void 0,t.WorkspaceBuilder=class{constructor(e){this.name=e}addControl(...e){}finalize(){}},t.AStepper=class{setWorld(e,t){this.world=e}getWorld(){if(!this.world)throw Error(`stepper without world ${this.constructor.name}`);return this.world}},t.OK={ok:!0},t.HAIBUN="HAIBUN",t.BASE_PREFIX=`${t.HAIBUN}_`,t.CAPTURE="capture",t.DEFAULT_DEST="default",t.BASE_DOMAINS=[{name:"string",resolve:e=>e}],t.BASE_TYPES=t.BASE_DOMAINS.map((e=>e.name))},52:(e,t,r)=>{"use strict";Object.defineProperty(t,"__esModule",{value:!0}),t.featureSplit=t.findFeaturesOfType=t.findFeatures=t.asFeatureLine=t.withNameType=t.expandFeatures=t.findUpper=t.expandBackgrounds=t.expand=void 0;const n=r(444);async function o(e){const t=[];for(const{path:r,content:n}of e){let o=n,s=i(r,e);for(;s.upper.length>0&&"/"!==s.rem;){s=i(s.rem,e);for(const e of s.upper)o=e.content+"\n"+o}t.push(u(r,o))}return t}t.expand=async function(e,t){const r=await o(e);return await c(t,r)},t.expandBackgrounds=o;const s=e=>{const t=e.split("/");return"/"+t.slice(1,t.length-1).join("/")};function i(e,t){const r=s(e),n=t.filter((e=>s(e.path)===r));return{rem:r,upper:n}}async function c(e,t){const r=[];for(const n of e){const e=await a(n,t),o={path:n.path,type:n.type,name:n.name,expanded:e};r.push(o)}return r}async function a(e,r){let o=[];return(0,t.featureSplit)(e.content).forEach((s=>{const i=(0,n.getActionable)(s);i.match(/^Backgrounds: .*$/)||i.match(/^Scenarios: .*$/)?o=o.concat(function(e,r){const n=e.replace(/^.*?: /,"").split(",").map((e=>e.trim()));let o=[];for(const e of n){const n=p(e,r);if(1!==n.length)throw Error(`can't find single "${e}.feature" from ${r.map((e=>e.path)).join(", ")}`);const s=n[0];for(const e of(0,t.featureSplit)(s.content))o.push((0,t.asFeatureLine)(e,s))}return o}(s,r)):o.push((0,t.asFeatureLine)(s,e))})),o}function u(e,t){const r=e.split(".");return{path:e,name:r[0],type:3===r.length?r[1]:"feature",content:t}}function p(e,t,r="feature"){return f(t,r).filter((t=>t.path.endsWith(`/${e}.${l(r)}`)))}function f(e,t="feature"){return e.filter((e=>e.path.endsWith(`.${l(t)}`)))}t.findUpper=i,t.expandFeatures=c,t.withNameType=u,t.asFeatureLine=(e,t)=>({line:e,feature:t}),t.findFeatures=p,t.findFeaturesOfType=f;const l=e=>"feature"===e?"feature":`${e}.feature`;t.featureSplit=e=>e.trim().split("\n").map((e=>e.trim())).filter((e=>e.length>0))},444:function(e,t,r){"use strict";var n=this&&this.__createBinding||(Object.create?function(e,t,r,n){void 0===n&&(n=r);var o=Object.getOwnPropertyDescriptor(t,r);o&&!("get"in o?!t.__esModule:o.writable||o.configurable)||(o={enumerable:!0,get:function(){return t[r]}}),Object.defineProperty(e,n,o)}:function(e,t,r,n){void 0===n&&(n=r),e[n]=t[r]}),o=this&&this.__setModuleDefault||(Object.create?function(e,t){Object.defineProperty(e,"default",{enumerable:!0,value:t})}:function(e,t){e.default=t}),s=this&&this.__importStar||function(e){if(e&&e.__esModule)return e;var t={};if(null!=e)for(var r in e)"default"!==r&&Object.prototype.hasOwnProperty.call(e,r)&&n(t,e,r);return o(t,e),t},i=this&&this.__importDefault||function(e){return e&&e.__esModule?e:{default:e}};Object.defineProperty(t,"__esModule",{value:!0}),t.getFeatureTitlesFromResults=t.shortNum=t.friendlyTime=t.stringOrError=t.boolOrError=t.intOrError=t.descTag=t.getRunTag=t.applyResShouldContinue=t.getFromRuntime=t.findStepper=t.findStepperFromOption=t.getStepperOption=t.getStepperOptionName=t.verifyRequiredOptions=t.getStepperOptionValue=t.getPre=t.setWorldStepperOptions=t.verifyExtraOptions=t.sleep=t.isLowerCase=t.describeSteppers=t.getActionable=t.getConfigFromBase=t.getDefaultOptions=t.shouldProcess=t.recurse=t.debase=t.getSteppers=t.createSteppers=t.getStepper=t.actionOK=t.actionNotOK=t.resultOutput=t.use=void 0;const c=r(147),a=i(r(17)),u=r(658),p=r(52);async function f(e){try{return(await Promise.resolve().then((()=>s(r(73)(e))))).default}catch(t){throw console.error("failed including",e),console.error(t),t}}async function l(e){try{const t=d(e);return await f(t)}catch(t){throw console.error(`could not use ${e}`),t}}function d(e){return e.startsWith("~")?[process.cwd(),"node_modules",e.substr(1)].join("/"):e.match(/^[a-zA-Z].*/)?`../../steps/${e}`:a.default.resolve(process.cwd(),e)}function h(e,t,r){const n=!t||e.endsWith(`.${t}`),o=!r||!!r.find((t=>e.match(t)));return n&&o}function m(e){return["HAIBUN","O",e.constructor.name.toUpperCase()].join("_")+"_"}function g(e,t,r){for(const n of r){const r=m(n.prototype),o=e.replace(r,""),s=new n;if(e.startsWith(r)&&s.options[o])return s.options[o].parse(t)}}function S(e,t){return e.prototype?m(e.prototype)+t:m(e)+t}function y(e,t,r){return r[S(e,t)]}function O(e,t){const r=e.find((e=>e.constructor.name===t));if(!r)throw Error(`Cannot find ${t} from ${JSON.stringify(e.map((e=>e.constructor.name)),null,2)}`);return r}t.use=f,t.resultOutput=async function(e,t){if(e){const r=new(await f(e));if(r)return await r.writeOutput(t,{})}return t.ok?t:{...t,results:t.results?.filter((e=>!e.ok)).map((e=>e.stepResults=e.stepResults.filter((e=>!e.ok))))}},t.actionNotOK=function(e,t){return{ok:!1,message:e,...t}},t.actionOK=function(e){return{ok:!0,topics:e}},t.getStepper=l,t.createSteppers=async function(e){const t=[];for(const r of e)try{const e=new r;t.push(e)}catch(e){throw console.error(`create ${r} failed`,e,r),e}return t},t.getSteppers=async function(e){const t=[];for(const r of e)try{const e=await l(r);t.push(e)}catch(e){throw console.error(`get ${r} from "${d(r)}" failed`,e),e}return t},t.debase=function(e,t){return t.map((t=>({...t,path:t.path.replace(e,"")})))},t.recurse=function e(t,r,n){const o=(0,c.readdirSync)(t);let s=[];for(const i of o){const o=`${t}/${i}`;(0,c.statSync)(o).isDirectory()?s=s.concat(e(o,r,n)):h(o,r,n)&&s.push((0,p.withNameType)(o,(0,c.readFileSync)(o,"utf-8")))}return s},t.shouldProcess=h,t.getDefaultOptions=function(){return{mode:"all",steppers:["vars"],options:{DEST:u.DEFAULT_DEST}}},t.getConfigFromBase=function(e){const t=`${e}/config.json`;try{const e=JSON.parse((0,c.readFileSync)(t,"utf-8"));return e.options||(e.options={DEST:u.DEFAULT_DEST}),e}catch(e){return null}},t.getActionable=function(e){return e.replace(/#.*/,"").trim()},t.describeSteppers=function(e){return e?.map((e=>e.steps&&Object.keys(e?.steps).map((t=>`${e.constructor.name}:${t}`)))).join(" ")},t.isLowerCase=function(e){return e.toLowerCase()&&e!=e.toUpperCase()},t.sleep=e=>new Promise((t=>setTimeout(t,e))),t.verifyExtraOptions=async function(e,t){const r={...e};if(Object.entries(r)?.map((([e,n])=>{if(void 0===g(e,n,t))throw Error(`no option ${e}`);delete r[e]})),Object.keys(r).length>0)throw Error(`no options provided for ${r}`)},t.setWorldStepperOptions=async function(e,t){for(const r of e)r.setWorld(t,e)},t.getPre=m,t.getStepperOptionValue=g,t.verifyRequiredOptions=async function(e,t){let r=[];for(const n of e){const e=n.prototype;for(const o in e.options){const s=S(n,o);e.options[o].required&&!t[s]&&r.push(s)}}if(r.length)throw Error(`missing required options ${r}`)},t.getStepperOptionName=S,t.getStepperOption=y,t.findStepperFromOption=function(e,t,r,...n){const o=n.reduce(((e,n)=>e||y(t,n,r)),void 0);if(!o)throw Error(`Cannot find ${n} from ${t.constructor.name} options`);return O(e,o)},t.findStepper=O,t.getFromRuntime=function(e,t){return e[t]},t.applyResShouldContinue=function(e,t,r){const{score:n,message:o}=t;if(t.ok)return!0;if(e.options.continueOnErrorIfScored&&void 0!==n){const t={score:n,message:o,action:r};return e.shared.values._scored.push(t),!0}return!1},t.getRunTag=(e,t,r,n,o={},s=!1)=>{const i={sequence:e,loop:t,member:n,featureNum:r,params:o,trace:s};return["sequence","loop","member","featureNum"].forEach((e=>{const t=i[e];if(parseInt(t)!==t)throw Error(`missing ${e} from ${JSON.stringify(i)}`)})),i},t.descTag=e=>` @${e.sequence} (${e.loop}x${e.member})`,t.intOrError=e=>e.match(/[^\d+]/)?{error:`${e} is not an integer`}:{result:parseInt(e,10)},t.boolOrError=e=>"false"!==e&&"true"!==e?{error:`${e} is not true or false`}:{result:"true"===e},t.stringOrError=e=>null==e?{error:`${e} is not defined`}:{result:e},t.friendlyTime=function(e){return new Date(e).toLocaleString()},t.shortNum=e=>Math.round(100*e)/100,t.getFeatureTitlesFromResults=e=>e.stepResults.filter((e=>e.actionResults.find((e=>"feature"===e.name)))).map((e=>e.in.replace(/^Feature: /,"")))},73:e=>{function t(e){var t=new Error("Cannot find module '"+e+"'");throw t.code="MODULE_NOT_FOUND",t}t.keys=()=>[],t.resolve=t,t.id=73,e.exports=t},147:e=>{"use strict";e.exports=require("fs")},17:e=>{"use strict";e.exports=require("path")}},t={};function r(n){var o=t[n];if(void 0!==o)return o.exports;var s=t[n]={exports:{}};return e[n].call(s.exports,s,s.exports,r),s.exports}r.d=(e,t)=>{for(var n in t)r.o(t,n)&&!r.o(e,n)&&Object.defineProperty(e,n,{enumerable:!0,get:t[n]})},r.o=(e,t)=>Object.prototype.hasOwnProperty.call(e,t),r.r=e=>{"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(e,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(e,"__esModule",{value:!0})},(()=>{"use strict";const e=r(658);r(444),r(437),r(893);e.AStepper})()})();