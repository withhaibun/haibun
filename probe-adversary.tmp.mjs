import { chromium } from 'playwright';
const URL = 'http://localhost:7777/credentials#?col=shu-polymorphic-graph-view&col=shu-document-column&active=shu-polymorphic-graph-view&label=Body&sort=generatedAtTime';
const HELPERS = () => {
  const deep = (sel) => { const seen = new Set(); const walk = (root) => { const hit = root.querySelector(sel); if (hit) return hit;
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot && !seen.has(el.shadowRoot)) { seen.add(el.shadowRoot); const r = walk(el.shadowRoot); if (r) return r; } return null; }; return walk(document); };
  globalThis.__doc = () => deep('shu-document-column');
  globalThis.__vc = () => { const dc = globalThis.__doc(); return dc.shadowRoot.querySelector('shu-virtual-column'); };
  globalThis.__virt = () => { const lv = globalThis.__vc().querySelector('lit-virtualizer');
    const sym = Object.getOwnPropertySymbols(lv).find((s) => String(s).includes('virtualizerRef')); return { lv, v: lv[sym] }; };
  globalThis.__ty = (el) => { const t = getComputedStyle(el).transform; const m = t && t.match(/matrix\(([^)]+)\)/); return m ? parseFloat(m[1].split(',')[5]) : null; };
  globalThis.__rows = () => { const { lv, v } = globalThis.__virt(); const first = v._first; const L = v._layout;
    return Array.from(lv.children).map((el, n) => { const idx = first + n; const r = el.getBoundingClientRect();
      return { idx, ty: globalThis.__ty(el), h: +r.height.toFixed(1), top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1),
        thumbs: el.querySelectorAll('.thumb-row').length, frames: el.querySelectorAll('shu-artifact-frame').length,
        rowSize: L.rowSize(idx), getSize: L._getSize(idx), cache: L._metricsCache.getChildSize(idx),
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 52) }; }); };
  globalThis.__report = () => { const rows = globalThis.__rows();
    return rows.map((r, n) => { const nx = rows[n + 1]; return { ...r, assigned: nx && r.ty !== null && nx.ty !== null ? +(nx.ty - r.ty).toFixed(1) : null }; }); };
  // does any text row paint inside a strip's box?
  globalThis.__overlaps = () => { const rows = globalThis.__rows(); const out = [];
    for (const s of rows.filter((r) => r.thumbs > 0))
      for (const t of rows) if (t.idx !== s.idx && t.text && t.top < s.bottom - 2 && t.bottom > s.top + 2) out.push({ strip: s.idx, stripTop: s.top, stripBottom: s.bottom, over: t.idx, top: t.top, h: t.h, text: t.text });
    return out; };
};
const line = (r) => `idx=${r.idx} ty=${r.ty} measured=${r.h} assigned=${r.assigned} rowSize=${r.rowSize} _getSize=${r.getSize} cache=${r.cache} th=${r.thumbs} fr=${r.frames} top=${r.top} | ${r.text}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(URL, { waitUntil: 'load' });
await page.evaluate(HELPERS);
await page.waitForFunction(() => { try { const h = globalThis.__virt(); return h.lv.children.length > 2; } catch { return false; } }, null, { timeout: 90000 });
await page.waitForTimeout(3000);
await page.evaluate(HELPERS);
await page.evaluate(() => { globalThis.__vc().follow = false; globalThis.__virt().lv.scrollTop = 0; });
await page.waitForTimeout(1200);
// walk down until row 66 is in the rendered range
for (let i = 0; i < 60; i++) { const r = await page.evaluate(() => { const { lv, v } = globalThis.__virt(); return { first: v._first, last: v._last, top: lv.scrollTop }; });
  if (r.first <= 66 && r.last >= 66) break; await page.evaluate(() => { globalThis.__virt().lv.scrollTop += 500; }); await page.waitForTimeout(240); }
await page.evaluate(() => { const { lv, v } = globalThis.__virt(); const el = lv.children[66 - v._first]; if (el) lv.scrollTop += el.getBoundingClientRect().top - lv.getBoundingClientRect().top - 40; });
await page.waitForTimeout(900);
await page.evaluate(HELPERS);
console.log('=== BEFORE (rowSize as shipped) ===');
console.log((await page.evaluate(() => globalThis.__report())).map(line).join('\n'));
console.log('--- text painted inside a strip box ---');
console.log(JSON.stringify(await page.evaluate(() => globalThis.__overlaps()), null, 1));
await page.screenshot({ path: '/tmp/adv-before.png' });

console.log('\n=== INTERVENTION: layout.rowSize = () => undefined, reflow ===');
await page.evaluate(async () => { const { lv, v } = globalThis.__virt(); const keep = lv.scrollTop;
  lv.layout.rowSize = () => undefined; v._layout.rowSize = () => undefined; v._layout._scheduleReflow(); await new Promise((r) => setTimeout(r, 500));
  lv.scrollTop = keep + 2; await new Promise((r) => setTimeout(r, 400)); lv.scrollTop = keep; await new Promise((r) => setTimeout(r, 900)); });
await page.evaluate(HELPERS);
await page.evaluate(() => { const { lv, v } = globalThis.__virt(); const el = lv.children[66 - v._first]; if (el) lv.scrollTop += el.getBoundingClientRect().top - lv.getBoundingClientRect().top - 40; });
await page.waitForTimeout(900);
await page.evaluate(HELPERS);
console.log((await page.evaluate(() => globalThis.__report())).map(line).join('\n'));
console.log('--- text painted inside a strip box ---');
console.log(JSON.stringify(await page.evaluate(() => globalThis.__overlaps()), null, 1));
console.log('--- scrollHeight before/after ---', await page.evaluate(() => globalThis.__virt().lv.scrollHeight));
await page.screenshot({ path: '/tmp/adv-after.png' });
await browser.close();
