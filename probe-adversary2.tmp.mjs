import { chromium } from 'playwright';
const URL = 'http://localhost:7777/credentials#?col=shu-polymorphic-graph-view&col=shu-document-column&active=shu-polymorphic-graph-view&label=Body&sort=generatedAtTime';
const H = () => {
  const deep = (sel) => { const seen = new Set(); const walk = (r) => { const h = r.querySelector(sel); if (h) return h;
    for (const el of r.querySelectorAll('*')) if (el.shadowRoot && !seen.has(el.shadowRoot)) { seen.add(el.shadowRoot); const x = walk(el.shadowRoot); if (x) return x; } return null; }; return walk(document); };
  globalThis.__vc = () => deep('shu-document-column').shadowRoot.querySelector('shu-virtual-column');
  globalThis.__virt = () => { const lv = globalThis.__vc().querySelector('lit-virtualizer'); const s = Object.getOwnPropertySymbols(lv).find((x) => String(x).includes('virtualizerRef')); return { lv, v: lv[s] }; };
};
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await p.goto(URL, { waitUntil: 'load' });
await p.evaluate(H);
await p.waitForFunction(() => { try { return globalThis.__virt().lv.children.length > 2; } catch { return false; } }, null, { timeout: 90000 });
await p.waitForTimeout(3000);
await p.evaluate(H);
await p.evaluate(() => { globalThis.__vc().follow = false; globalThis.__virt().lv.scrollTop = 0; });
await p.waitForTimeout(1200);
for (let i = 0; i < 60; i++) { const r = await p.evaluate(() => { const { v } = globalThis.__virt(); return { f: v._first, l: v._last }; });
  if (r.f <= 66 && r.l >= 66) break; await p.evaluate(() => { globalThis.__virt().lv.scrollTop += 500; }); await p.waitForTimeout(240); }
await p.evaluate(() => { const { lv, v } = globalThis.__virt(); const el = lv.children[66 - v._first]; if (el) lv.scrollTop += el.getBoundingClientRect().top - lv.getBoundingClientRect().top - 30; });
await p.waitForTimeout(1000);
await p.evaluate(H);
console.log(await p.evaluate(() => { const { lv, v } = globalThis.__virt(); const at = (i) => lv.children[i - v._first];
  const strip = at(66), empty = at(70), ctrl = at(59), next = at(80);
  const frame = strip.querySelector('shu-artifact-frame');
  const img = frame && frame.shadowRoot ? frame.shadowRoot.querySelector('img') : null;
  const slotted = frame ? frame.querySelector('img') : null;
  const theImg = img || slotted;
  const grid = strip.querySelector('.thumb-row');
  return JSON.stringify({
    strip: { outerHead: strip.outerHTML.slice(0, 260), rect: strip.getBoundingClientRect().height, gridCols: grid ? getComputedStyle(grid).gridTemplateColumns : null, frames: strip.querySelectorAll('shu-artifact-frame').length,
      framePos: frame ? getComputedStyle(frame).position : null, frameRect: frame ? [ +frame.getBoundingClientRect().width.toFixed(1), +frame.getBoundingClientRect().height.toFixed(1) ] : null,
      imgH: theImg ? +theImg.getBoundingClientRect().height.toFixed(1) : null, imgAR: theImg ? getComputedStyle(theImg).aspectRatio : null, imgNat: theImg ? [theImg.naturalWidth, theImg.naturalHeight] : null },
    emptyRow: { outer: empty.outerHTML.slice(0, 200), h: empty.getBoundingClientRect().height },
    control59: { outer: ctrl.outerHTML.slice(0, 200), h: ctrl.getBoundingClientRect().height },
    row80: { outer: next.outerHTML.slice(0, 160), top: +next.getBoundingClientRect().top.toFixed(1) },
    stripBox: [ +strip.getBoundingClientRect().top.toFixed(1), +strip.getBoundingClientRect().bottom.toFixed(1) ],
    zIndexStrip: getComputedStyle(strip).zIndex, zIndexNext: getComputedStyle(next).zIndex,
    // what actually paints at a point inside the strip where row 80's text is
    hitAt: (() => { const r80 = next.getBoundingClientRect(); const el = document.elementFromPoint(Math.round(r80.left + 40), Math.round(r80.top + 10)); return el ? el.tagName + '.' + el.className : null; })(),
  }, null, 1); }));
await p.screenshot({ path: '/tmp/adv-overlap.png' });
await b.close();
