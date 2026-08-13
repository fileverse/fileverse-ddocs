/* Block-chrome parity probe (v1 vs v2), driven with TRUSTED mouse input.
 *
 * Usage:
 *   npx vite demo                 # in another terminal, must be on :5173
 *   node scripts/chrome-parity-probe.cjs "$(mktemp -d)" myrun
 *
 * Covers the things that only fail under real hit-testing or real timing, and
 * that synthetic element.click() reports as passing:
 *   1. cluster    - hover a block, the floating controls must be hit-testable
 *                   (a covered button still "clicks" synthetically), the
 *                   chevron must toggle collapse, the grip must open the menu
 *   2. collapse   - toggling must not move the viewport (it used to scroll to
 *                   a caret that was never touched, throwing you to the top)
 *   3. templates  - the overlay must appear on a blank doc and insert, with no
 *                   dBlock left behind in the flat schema
 *   4. staleTab   - reopening a multi-tab doc must never paint the wrong tab
 *                   first (the saved blob's activeTabId lags IndexedDB)
 */
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require(path.join(REPO, 'node_modules/ws'));

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9380;
const BASE = 'http://localhost:5173/';

const getJson = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d)));
  }).on('error', rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.argv[2]}`,
    '--no-first-run', '--window-size=1500,950', 'about:blank',
  ]);
  process.on('exit', () => chrome.kill());
  let targets = null;
  for (let i = 0; i < 30; i++) { try { targets = await getJson('/json/list'); break; } catch { await sleep(500); } }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 128e6 });
  await new Promise((r) => ws.on('open', r));
  let msgId = 0; const pending = new Map(); const pageErrors = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push((m.params.exceptionDetails.exception?.description || '').slice(0, 160));
  });
  const send = (method, params = {}) =>
    new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, timeout: 120000 });
    if (r.result.exceptionDetails) return { __error: JSON.stringify(r.result.exceptionDetails).slice(0, 220) };
    return r.result.result.value;
  };
  const mouse = (type, x, y, ex = {}) => send('Input.dispatchMouseEvent', {
    type, x, y, button: ex.button || 'none', buttons: ex.buttons || 0,
    clickCount: ex.clickCount || 0, pointerType: 'mouse',
  });
  const moveTo = async (x, y) => { await mouse('mouseMoved', x, y); await sleep(120); await mouse('mouseMoved', x, y); await sleep(320); };
  const click = async (x, y) => {
    await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 });
    await sleep(80);
    await mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 });
    await sleep(700);
  };
  const ready = () => ev(`new Promise((r, j) => {
    const dl = Date.now() + 60000;
    const t = () => { if (window.__ddoc?.current?.getEditor?.()) return r(1);
      if (Date.now() > dl) return j(new Error('not ready')); setTimeout(t, 120); };
    t();
  })`);
  const nav = async (url) => { await send('Page.navigate', { url }); await ready(); await sleep(1200); };

  // The app scrolls an ancestor with overflow auto/scroll, NOT the page and
  // NOT .ProseMirror. Match on overflow, not on a height difference.
  const SCROLLER = `(() => {
    let el = document.querySelector('.ProseMirror');
    while (el && el !== document.documentElement) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 100) return el;
      el = el.parentElement;
    }
    return document.scrollingElement;
  })()`;

  await send('Runtime.enable');
  // Required before addScriptToEvaluateOnNewDocument, which the stale-tab
  // check relies on to observe the very first paint after a reload.
  await send('Page.enable');
  const RUN = process.argv[3] || 'c1';
  const out = { v1: {}, v2: {} };

  for (const schema of ['v1', 'v2']) {
    const v2 = schema === 'v2';
    const url = (slug) => `${BASE}?doc=${schema}-${slug}-${RUN}${v2 ? '&v2=1' : ''}`;
    const r = out[schema];

    // --- 1. cluster: hover, hit-test, collapse, grip menu ---
    await nav(url('cluster'));
    await ev(`(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.focus('start');
      e.commands.insertContent('<h2>Cluster Heading</h2><p>alpha</p><p>beta</p>');
      await new Promise(r => setTimeout(r, 800));
      return 1;
    })()`);
    const head = await ev(`(() => {
      const pm = document.querySelector('.ProseMirror');
      const h = Array.from(pm.children).find(el => (el.textContent||'').includes('Cluster Heading'));
      const b = h.getBoundingClientRect();
      return { x: Math.round(b.left + 50), y: Math.round(b.top + b.height / 2) };
    })()`);
    await moveTo(head.x, head.y);
    const cluster = await ev(`(() => {
      const c = document.querySelector('[aria-label="block-controls"]');
      if (!c) return { present: false };
      const btns = Array.from(c.querySelectorAll('button')).map(b => {
        const q = b.getBoundingClientRect();
        return { x: Math.round(q.left + q.width/2), y: Math.round(q.top + q.height/2),
                 visible: getComputedStyle(b).visibility !== 'hidden' };
      });
      return { present: true, count: btns.length, btns };
    })()`);
    r.cluster = { present: cluster.present, buttons: cluster.count };
    if (cluster.present && cluster.btns.length >= 2) {
      const chevron = cluster.btns[cluster.btns.length - 1];
      const grip = cluster.btns[cluster.btns.length - 2];
      // A covered button still passes a synthetic click; hit-test proves it.
      r.cluster.chevronHitTestable = await ev(`(() => {
        const el = document.elementFromPoint(${chevron.x}, ${chevron.y});
        return Boolean(el && el.closest('[aria-label="block-controls"]'));
      })()`);
      await moveTo(chevron.x, chevron.y);
      await click(chevron.x, chevron.y);
      r.cluster.collapseWorked = await ev(`(() => {
        let c = false;
        window.__ddoc.current.getEditor().state.doc.descendants(n => {
          if (n.type.name === 'heading' && n.attrs.isCollapsed) c = true; });
        return c;
      })()`);
      await moveTo(head.x, head.y);
      const g2 = await ev(`(() => {
        const c = document.querySelector('[aria-label="block-controls"]');
        if (!c) return null;
        const bs = Array.from(c.querySelectorAll('button'));
        const b = bs[bs.length - 2]; if (!b) return null;
        const q = b.getBoundingClientRect();
        return { x: Math.round(q.left + q.width/2), y: Math.round(q.top + q.height/2) };
      })()`);
      if (g2) {
        await moveTo(g2.x, g2.y); await click(g2.x, g2.y);
        r.cluster.gripMenuOpens = await ev(`Boolean(document.querySelector('[role="menu"],[data-radix-popper-content-wrapper]'))`);
      }
      void grip;
    }

    // --- 2. collapse must not move the viewport ---
    await nav(url('scroll'));
    await ev(`(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.focus('start');
      const parts = [];
      for (let s = 0; s < 6; s++) {
        parts.push('<h2>Section ' + s + '</h2>');
        for (let p = 0; p < 12; p++) parts.push('<p>Sec ' + s + ' para ' + p + ' lorem ipsum dolor sit amet.</p>');
      }
      e.commands.insertContent(parts.join(''));
      await new Promise(r => setTimeout(r, 1500));
      e.commands.setTextSelection(1);   // caret parked far from the target
      return 1;
    })()`);
    const mid = await ev(`(async () => {
      const pm = document.querySelector('.ProseMirror');
      const h = Array.from(pm.querySelectorAll('h2'))[2];   // middle, not last:
      h.scrollIntoView({ block: 'center' });                // the last one lets
      await new Promise(r => setTimeout(r, 700));           // clamping mask a jump
      const b = h.getBoundingClientRect();
      return { x: Math.round(b.left + 50), y: Math.round(b.top + b.height/2),
               scrollTop: Math.round((${SCROLLER}).scrollTop), headY: Math.round(b.top) };
    })()`);
    await moveTo(mid.x, mid.y);
    const btn = await ev(`(() => {
      const c = document.querySelector('[aria-label="block-controls"]');
      if (!c) return null;
      const bs = Array.from(c.querySelectorAll('button'));
      const b = bs[bs.length - 1];
      const q = b.getBoundingClientRect();
      return { x: Math.round(q.left + q.width/2), y: Math.round(q.top + q.height/2) };
    })()`);
    if (btn) {
      await click(btn.x, btn.y);
      const after = await ev(`(() => {
        const hs = Array.from(document.querySelectorAll('.ProseMirror h2'));
        return { scrollTop: Math.round((${SCROLLER}).scrollTop),
                 headY: hs[2] ? Math.round(hs[2].getBoundingClientRect().top) : null };
      })()`);
      r.collapseScroll = {
        scrollTop: [mid.scrollTop, after.scrollTop],
        headingViewportY: [mid.headY, after.headY],
        viewportHeld: Math.abs(after.headY - mid.headY) <= 24,
      };
    }

    // --- 3. template overlay on a blank doc ---
    await nav(url('tpl'));
    r.template = await ev(`(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.focus('start');
      await new Promise(r => setTimeout(r, 900));
      const overlay = document.querySelector('[data-template-overlay]');
      if (!overlay) return { overlayVisible: false };
      const btn = Array.from(overlay.querySelectorAll('button'))
        .find(b => /to-do/i.test(b.textContent || ''));
      if (!btn) return { overlayVisible: true, clicked: false };
      btn.click();
      await new Promise(r => setTimeout(r, 1600));
      return {
        overlayVisible: true, clicked: true,
        blocks: e.state.doc.childCount,
        textLen: e.state.doc.textContent.replace(/\\s+/g, ' ').trim().length,
        hasDBlock: JSON.stringify(e.getJSON()).includes('"dBlock"'),
      };
    })()`);

    // --- 4. multi-tab reload must not paint a stale tab ---
    const tabDoc = `${schema}-tabs-${RUN}`;
    await nav(`${BASE}?doc=${tabDoc}${v2 ? '&v2=1' : ''}`);
    const built = await ev(`(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.insertContent('<p>tab one</p>');
      await new Promise(r => setTimeout(r, 500));
      for (let i = 0; i < 3; i++) {
        const b = document.querySelector('[data-testid="tab-create-button"]');
        if (!b) return { built: false };
        b.click();
        await new Promise(r => setTimeout(r, 1500));
        window.__ddoc.current.getEditor().commands.insertContent('<p>content for tab ' + (i+2) + '</p>');
        await new Promise(r => setTimeout(r, 500));
      }
      const items = Array.from(document.querySelectorAll('[data-testid^="tab-item-"]'));
      items[2].click();                       // leave tab 3 active
      await new Promise(r => setTimeout(r, 1600));
      return { built: true, tabs: items.length,
               active: window.__ddoc.current.getYdoc().getMap('tabs_state').get('activeTabId') };
    })()`);
    if (built.built) {
      await sleep(1200);
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `
        window.__seen = [];
        (function tick(){
          try {
            const el = document.querySelector('[data-ddoc-editor-panel][aria-hidden="false"] .ProseMirror');
            if (el && el.offsetParent !== null) {
              const t = el.textContent.trim().slice(0, 24);
              if (t && (!window.__seen.length || window.__seen[window.__seen.length-1] !== t)) window.__seen.push(t);
            }
          } catch (e) {}
          setTimeout(tick, 40);
        })();` });
      await send('Page.navigate', { url: `${BASE}?doc=${tabDoc}${v2 ? '&v2=1' : ''}` });
      await ready(); await sleep(5000);
      const seen = await ev(`window.__seen || []`);
      r.staleTab = { paintedSequence: seen,
                     paintedWrongTabFirst: seen.length > 1,
                     finalText: seen[seen.length - 1] || null };
    }
  }

  out.pageErrors = pageErrors;
  console.log(JSON.stringify(out, null, 2));
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch((e) => { console.error('PROBE-FAILED:', e.message); process.exit(1); });
