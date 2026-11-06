/* Pages mode gate: on-screen sheets, and does Chrome's print break pages where
 * the screen does? (docs/PAGES_MODE.md §6.3, §12.12)
 *
 * Usage:
 *   cd demo && npx vite --port 5174       # in another terminal
 *   npm i --no-save pdfjs-dist@4.10.38     # once; kept out of package.json
 *   node scripts/pages-print-check.cjs "$(mktemp -d)" [--base http://localhost:5174/] [--only 01,04]
 *   node scripts/pages-print-check.cjs "$(mktemp -d)" --invariants   # I1, I2, Enter at the end
 *   node scripts/pages-print-check.cjs --pdf-dir <folder>   # PDFs printed by hand, debug markers on
 *
 * Each case loads a fixture in a real (headless) Chrome, waits for the passes
 * to settle (and checks none runs in the next 2 s), checks every leaf sits on a
 * sheet (I4), checks screen vs print-root block heights, prints to PDF with
 * §Pn§ markers on every page start of the plugin's placement, and reads them
 * back: page n must carry exactly §Pn§, and the PDF has the store's page count.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const WebSocket = require(path.join(REPO, 'node_modules/ws'));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9381;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadPdfText() {
  let pdfjs;
  try {
    pdfjs = await import(
      path.join(REPO, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')
    );
  } catch {
    console.error('pdfjs-dist missing: npm i --no-save pdfjs-dist@4.10.38');
    process.exit(2);
  }
  return async (bytes) => {
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      disableFontFace: true,
      verbosity: 0,
    }).promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(content.items.map((item) => item.str).join(''));
    }
    return pages;
  };
}

const firstText = (text) =>
  text
    .replace(/§\s*P\s*\d+\s*§/g, '')
    .trim()
    .slice(0, 40);

async function checkFolder(dir, pdfText, checkMarkers) {
  let failed = 0;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.pdf'))) {
    const pages = await pdfText(fs.readFileSync(path.join(dir, file)));
    const result = checkMarkers(pages);
    if (!result.ok) failed += 1;
    console.log(
      `${result.ok ? 'PASS' : 'FAIL'}  ${file}  pages ${pages.length}${
        result.ok ? '' : `  ${result.problems[0]}`
      }`,
    );
  }
  process.exit(failed ? 1 : 0);
}

const getJson = (p) =>
  new Promise((res, rej) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => res(JSON.parse(d)));
      })
      .on('error', rej);
  });

async function openChrome(profile) {
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--window-size=1600,1100',
    'about:blank',
  ]);
  let targets = null;
  for (let i = 0; i < 40 && !targets; i += 1) {
    try {
      targets = await getJson('/json/list');
    } catch {
      await sleep(500);
    }
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256e6 });
  await new Promise((r) => ws.on('open', r));
  let msgId = 0;
  const pending = new Map();
  const errors = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(
        (m.params.exceptionDetails.exception?.description || '').slice(0, 160),
      );
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      const text = m.params.args.map((a) => a.value ?? '').join(' ');
      if (text.includes('ddoc pagination')) errors.push(text.slice(0, 160));
    }
  });
  const send = (method, params = {}) =>
    new Promise((res) => {
      const id = ++msgId;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: 120000,
    });
    if (r.result.exceptionDetails) {
      throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    }
    return r.result.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  const close = async () => {
    ws.close();
    chrome.kill();
    await sleep(800);
  };
  return { send, ev, errors, close };
}

// Waits for this navigation's page: right after Page.navigate the previous
// page (already ready) can still answer, so the whole query must match.
const waitReady = (ev, search) =>
  ev(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 60000;
    const tick = () => {
      const isThisPage = location.search === ${JSON.stringify(`?${search}`)};
      if (isThisPage && window.__ddocPages?.ready) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('fixture never ready'));
      setTimeout(tick, 150);
    };
    tick();
  })`);

// Resolves with pass() once no pass is pending, two frames later.
const waitSettled = (ev) =>
  ev(`new Promise((resolve) => {
    const deadline = Date.now() + 20000;
    const frames = () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const tick = async () => {
      const p = window.__ddocPages.pass();
      if (p && p.passCount > 0 && p.settled) {
        await frames();
        const again = window.__ddocPages.pass();
        if (again.settled) return resolve(again);
      }
      if (Date.now() > deadline) return resolve(p);
      setTimeout(tick, 50);
    };
    tick();
  })`);

let navigations = 0;
async function open(chrome, base, c, extra = {}) {
  // One doc per schema: the schema is stamped when a doc is created.
  const doc = extra.doc || `pages-m0-${c.schema}`;
  const query = new URLSearchParams({
    doc,
    pagesFixture: c.id,
    paper: c.paper || 'a4',
  });
  if (c.landscape) query.set('orientation', 'landscape');
  if (c.schema === 'v1') query.set('v1', '1');
  if (extra.mode) query.set('mode', extra.mode);
  // A fresh URL every time, so waitReady never sees the previous page.
  query.set('n', String((navigations += 1)));
  await chrome.send('Page.navigate', { url: `${base}?${query}` });
  await waitReady(chrome.ev, query.toString());
  const stamp = await chrome.ev(
    `window.__ddoc.current.getYdoc().getMap('ddocMeta').get('schemaVersion') ?? null`,
  );
  return (stamp === 2 ? 'v2' : 'v1') === c.schema
    ? null
    : `schema stamp ${stamp}`;
}

const editorJs = 'window.__ddoc.current.getEditor()';

async function runCase(chrome, base, c, pdfText, checkMarkers, pdfDir) {
  const wrongSchema = await open(chrome, base, c);
  if (wrongSchema) return { ...c, result: 'SKIP', problems: [wrongSchema] };
  const problems = [];
  if (c.id === '02c') {
    const collapsed = await chrome.ev(`(() => {
      let n = 0;
      ${editorJs}.state.doc.descendants((node) => { if (node.attrs.isCollapsed) n += 1; });
      return n;
    })()`);
    if (!collapsed) problems.push('02c: no collapsed heading in the doc');
  }
  // Settles: passes stop, and none runs without a trigger.
  const settled = await waitSettled(chrome.ev);
  await sleep(2000);
  const later = await chrome.ev('window.__ddocPages.pass()');
  const settleOk =
    settled?.settled && later.passCount === settled.passCount && later.settled;
  if (!settleOk) {
    problems.push(
      `settle: ${settled?.passCount} passes, ${later.passCount} after 2 s`,
    );
  }
  const sheets = await chrome.ev('window.__ddocPages.sheetCheck()');
  problems.push(...(sheets?.problems ?? ['sheetCheck: no store']).slice(0, 3));
  const storePages = later.pageCount;
  const breaks = await chrome.ev('window.__ddocPages.breaks()');
  const parity = await chrome.ev('window.__ddocPages.parity()');
  await chrome.ev('window.__ddocPages.mountPrint(true)');
  const pdf = await chrome.send('Page.printToPDF', {
    preferCSSPageSize: true,
    printBackground: true,
  });
  await chrome.ev('window.__ddocPages.unmountPrint()');
  const bytes = Buffer.from(pdf.result.data, 'base64');
  const name = `${c.id}-${c.schema}-${c.paper}${c.landscape ? '-landscape' : ''}.pdf`;
  fs.writeFileSync(path.join(pdfDir, name), bytes);
  const pages = await pdfText(bytes);
  const continued = breaks.pageStarts
    .map((start, i) => (start.kind === 'continued' ? i + 1 : 0))
    .filter(Boolean);
  const markers = checkMarkers(pages, storePages, continued);
  if (breaks.pageCount !== storePages) {
    problems.push(`placement ${breaks.pageCount} pages, store ${storePages}`);
  }
  problems.push(
    ...(parity.ok
      ? []
      : parity.mismatches
          .slice(0, 2)
          .map(
            (m) =>
              `parity #${m.index} ${m.tag} screen ${m.screen} print ${m.print} "${m.text}"`,
          )),
    ...markers.problems.slice(0, 2),
  );
  // First text of the first mismatched page, to find it on screen.
  const badPage = markers.problems
    .map((p) => /^page (\d+)/.exec(p)?.[1])
    .find(Boolean);
  if (badPage) {
    problems.push(
      `printed page ${badPage} starts "${firstText(pages[badPage - 1])}", predicted "${
        breaks.pageFirstText[badPage - 1] ?? '-'
      }"`,
    );
  }
  const sheetOk = !!sheets?.ok;
  return {
    ...c,
    sheets: sheetOk ? 'ok' : `${sheets?.problems.length ?? '-'} bad`,
    markers: markers.ok ? 'ok' : `${markers.problems.length} bad`,
    parity: parity.ok ? 'ok' : `${parity.mismatches.length} diff`,
    pages: `${storePages}/${pages.length}`,
    settle: settleOk ? `ok (${later.passCount})` : 'FAIL',
    result:
      markers.ok && parity.ok && sheetOk && settleOk && problems.length === 0
        ? 'PASS'
        : 'FAIL',
    problems,
  };
}

// Fixture 01 at zoom 1.5, Fit and 0.75: same placement as 1, every leaf on a
// sheet, and the zoom's pass does not dispatch (breaks do not move with zoom).
async function zoomCheck(chrome, base, schema) {
  await open(chrome, base, { id: '01', schema, paper: 'a4' });
  // Counts every dispatching pass, so a transient A -> A' -> A shows too.
  const at = async (zoom) => {
    const before = await waitSettled(chrome.ev);
    await chrome.ev(`window.__ddocPages.setZoomLevel(${JSON.stringify(zoom)})`);
    await sleep(400);
    const pass = await waitSettled(chrome.ev);
    const b = await chrome.ev('window.__ddocPages.breaks()');
    const sheets = await chrome.ev('window.__ddocPages.sheetCheck()');
    return {
      placement: JSON.stringify(b.spacers),
      dispatched: pass.dispatches !== before.dispatches,
      sheets,
    };
  };
  const one = await at('1');
  const results = [];
  let ok = true;
  for (const zoom of ['1.5', 'fit', '0.75']) {
    const r = await at(zoom);
    const same = r.placement === one.placement;
    ok = ok && same && !r.dispatched && r.sheets.ok;
    results.push(
      `${zoom}: ${same ? 'same' : 'DIFFERENT'}, sheets ${
        r.sheets.ok ? 'ok' : r.sheets.problems[0]
      }${r.dispatched ? ', DISPATCHED' : ''}`,
    );
  }
  await at('1');
  return { ok, text: results.join('; ') };
}

const KEYS = {
  Enter: { code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  Backspace: { code: 'Backspace', windowsVirtualKeyCode: 8 },
};
async function press(chrome, key) {
  await chrome.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    ...KEYS[key],
  });
  await chrome.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    ...KEYS[key],
  });
}

const activeTab = (ev) =>
  ev(
    `document.querySelector('[data-testid^="tab-item-"][data-active="true"]')?.dataset.testid ?? null`,
  );

// I1 (§12.12): no Yjs write from 50+ passes driven by zooms, resizes and tab
// switches. A tab switch writes the host's tab-manager map (tabs_state) itself,
// so the check is: every tab's XmlFragment content is unchanged, and no Yjs
// transaction touched anything outside tabs_state.
async function noWrites(chrome, base, schema) {
  const doc = `pages-inv-${schema}`;
  await open(chrome, base, { id: '10', schema }, { doc });
  let tabs = await chrome.ev(
    `[...document.querySelectorAll('[data-testid^="tab-item-"]')].map((e) => e.dataset.testid)`,
  );
  if (tabs.length < 2) {
    await chrome.ev('window.__ddoc.current.createTab()');
    await sleep(1000);
    tabs = await chrome.ev(
      `[...document.querySelectorAll('[data-testid^="tab-item-"]')].map((e) => e.dataset.testid)`,
    );
  }
  const click = (id) =>
    chrome.ev(`document.querySelector('[data-testid="${id}"]').click()`);
  await click('tab-item-default');
  await sleep(500);
  await waitSettled(chrome.ev);

  await chrome.ev('window.__ddocPages.watchWrites()');
  const before = await chrome.ev('window.__ddocPages.tabContent()');
  // Per tab editor: its pass and dispatch counters (they restart on enable).
  const seen = {};
  let passes = 0;
  let dispatches = 0;
  const count = async () => {
    const tab = await activeTab(chrome.ev);
    const p = await waitSettled(chrome.ev);
    if (!p) return;
    const last = seen[tab] ?? { passCount: 0, dispatches: 0 };
    const grew = p.passCount >= last.passCount;
    passes += grew ? p.passCount - last.passCount : p.passCount;
    dispatches += grew ? p.dispatches - last.dispatches : p.dispatches;
    seen[tab] = p;
  };
  await count();
  passes = 0;
  dispatches = 0;
  const zooms = ['1.5', 'fit', '0.75', '1'];
  for (let i = 0; i < 60 && passes < 50; i += 1) {
    if (i % 5 === 4) {
      await click(tabs.find((t) => t !== 'tab-item-default'));
      await sleep(300);
      await count();
      await click('tab-item-default');
    } else if (i % 5 === 2) {
      await chrome.send('Emulation.setDeviceMetricsOverride', {
        width: i % 2 ? 1300 : 1600,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: false,
      });
    } else {
      await chrome.ev(
        `window.__ddocPages.setZoomLevel(${JSON.stringify(zooms[i % 4])})`,
      );
    }
    await sleep(300);
    await count();
  }
  await chrome.send('Emulation.clearDeviceMetricsOverride');
  await chrome.ev(`window.__ddocPages.setZoomLevel('1')`);
  const after = await chrome.ev('window.__ddocPages.tabContent()');
  const writes = await chrome.ev('window.__ddocPages.writes()');
  const foreign = writes.filter((w) => !w.startsWith('tabs_state'));
  const fragments = JSON.parse(after).length;
  const ok =
    passes >= 50 && dispatches === 0 && before === after && !foreign.length;
  return {
    ok,
    text: `${passes} passes, ${dispatches} dispatched, content of ${fragments} tabs ${
      before === after ? 'equal' : 'CHANGED'
    }, writes outside tabs_state: ${
      foreign.length ? [...new Set(foreign)].join(', ') : 'none'
    } (tab manager: ${writes.length - foreign.length})`,
  };
}

const SCRIPT = [
  ['text', 'Alpha beta gamma delta'],
  ['wait'],
  ['key', 'Enter'],
  ['text', 'Second line typed here'],
  ['wait'],
  ['text', ' and more words'],
  ['wait'],
  ['key', 'Enter'],
  ['key', 'Enter'],
  ['text', 'Third block'],
  ['wait'],
  ['key', 'Backspace'],
  ['key', 'Backspace'],
  ['wait'],
];

// I2 (§12.12): the same typing undoes in the same steps in Pages and
// Pageless. Each pause outlasts the undo capture (500 ms) and the pass
// debounce (300 ms), so a pass runs between typing groups and between undos.
// Then a dispatching pass inside the capture window: Enter at the end until
// the caret pass opens a page, and type at once. A pass that split the undo
// group would cost Pages one more step. Pageless presses the same Enters.
async function undoSteps(chrome, base, schema, mode, enters) {
  // A fresh doc: the v1 loader sometimes appends to an existing one.
  const doc = `pages-i2-${schema}-${mode}-${Date.now()}`;
  await open(chrome, base, { id: '10', schema }, { doc, mode });
  await chrome.ev(`(() => {
    const ed = ${editorJs};
    const ids = [...document.querySelectorAll('[data-testid^="tab-item-"]')];
    ids.find((e) => e.dataset.testid === 'tab-item-default')?.click();
    return ed ? true : false;
  })()`);
  await sleep(1000);
  const baseline = await chrome.ev(`JSON.stringify(${editorJs}.getJSON())`);
  // End of the second textblock, under the title.
  await chrome.ev(`(() => {
    const ed = ${editorJs};
    let seen = 0;
    let at = null;
    ed.state.doc.descendants((node, pos) => {
      if (at === null && node.isTextblock && ++seen === 2) at = pos + node.nodeSize - 1;
    });
    ed.commands.focus(at);
  })()`);
  for (const [kind, arg] of SCRIPT) {
    if (kind === 'text') await chrome.send('Input.insertText', { text: arg });
    if (kind === 'key') await press(chrome, arg);
    if (kind === 'wait') await sleep(800);
  }
  await chrome.ev(`${editorJs}.commands.focus('end')`);
  const dispatchesNow = () =>
    chrome.ev('window.__ddocPages.pass()?.dispatches ?? 0');
  const d0 = await dispatchesNow();
  let n = 0;
  let windowMs = 0;
  while (n < (enters ?? 80)) {
    await press(chrome, 'Enter');
    n += 1;
    const last = n === enters;
    // In the page, so the text follows the pass by one frame: wait two
    // frames, and if that Enter's pass dispatched (or it is Pageless's last
    // Enter), type right away.
    windowMs = await chrome.ev(`new Promise((resolve) => {
      const t0 = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const d = window.__ddocPages.pass()?.dispatches ?? 0;
        if (${last} || (${enters === undefined} && d > ${d0})) {
          const ed = ${editorJs};
          ed.view.dispatch(ed.state.tr.insertText('after the break'));
          resolve(performance.now() - t0);
        } else resolve(null);
      }));
    })`);
    if (windowMs !== null) break;
  }
  const dispatched = (await dispatchesNow()) > d0;
  await sleep(800);
  const typed = await chrome.ev(`${editorJs}.state.doc.textContent`);
  let steps = 0;
  let back = false;
  for (; steps < 60; steps += 1) {
    back = await chrome.ev(
      `JSON.stringify(${editorJs}.getJSON()) === ${JSON.stringify(baseline)}`,
    );
    if (back) break;
    await chrome.ev(`${editorJs}.commands.undo()`);
    await sleep(450);
  }
  return { steps, back, typed, enters: n, windowMs, dispatched };
}

// Review focus 1: Enter held at the end of the last page. After each key and
// two frames, the caret is on a sheet and the store has grown to hold it.
// Prose (01), so a tall table (10) does not mask the result.
async function enterAtEnd(chrome, base, schema) {
  await open(
    chrome,
    base,
    { id: '01', schema },
    { doc: `pages-inv-${schema}` },
  );
  await waitSettled(chrome.ev);
  const start = await chrome.ev('window.__ddocPages.pass().pageCount');
  await chrome.ev(`${editorJs}.commands.focus('end')`);
  const bad = [];
  for (let i = 0; i < 60; i += 1) {
    await press(chrome, 'Enter');
    const r =
      await chrome.ev(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const ed = ${editorJs};
      const view = ed.view;
      const scale = view.dom.getBoundingClientRect().height / view.dom.offsetHeight;
      const caret = view.coordsAtPos(view.state.selection.head);
      const bottom = (caret.bottom - view.dom.getBoundingClientRect().top) / scale;
      const pages = window.__ddocPages.pass().pageCount;
      const grid = ${JSON.stringify({ height: 1123, gap: 16 })};
      resolve({ bottom, pages, lastSheetBottom: pages * (grid.height + grid.gap) - grid.gap - 96 });
    })))`);
    if (r.bottom > r.lastSheetBottom + 1) {
      bad.push(
        `Enter ${i + 1}: caret at ${Math.round(r.bottom)}, last sheet text ends ${r.lastSheetBottom} (${r.pages} pages)`,
      );
    }
    await sleep(30);
  }
  const p = await waitSettled(chrome.ev);
  const sheets = await chrome.ev('window.__ddocPages.sheetCheck()');
  const ok = bad.length === 0 && p.pageCount > start && sheets.ok;
  return {
    ok,
    text: `pages ${start} -> ${p.pageCount}; ${bad.length ? bad.slice(0, 2).join('; ') : 'caret always on a sheet'}; sheets ${sheets.ok ? 'ok' : sheets.problems[0]}`,
  };
}

async function invariants(chrome, base, schema) {
  const results = [];
  const report = (ok, text) => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${text}`);
  };
  const i1 = await noWrites(chrome, base, schema);
  report(i1.ok, `I1 ${schema}: ${i1.text}`);
  const pages = await undoSteps(chrome, base, schema, 'pages');
  const pageless = await undoSteps(
    chrome,
    base,
    schema,
    'pageless',
    pages.enters,
  );
  const sameText = pages.typed === pageless.typed;
  // The pass must land inside the 500 ms capture window to test anything.
  const inWindow = pages.dispatched && pages.windowMs < 500;
  report(
    pages.back &&
      pageless.back &&
      pages.steps === pageless.steps &&
      sameText &&
      inWindow,
    `I2 ${schema}: undo steps Pages ${pages.steps}${
      pages.back ? '' : ' (not back)'
    }, Pageless ${pageless.steps}${pageless.back ? '' : ' (not back)'}${
      sameText ? '' : ', typed text differs'
    }; Enter x${pages.enters}, pass ${
      pages.dispatched ? 'dispatched' : 'DID NOT dispatch'
    }, typed ${Math.round(pages.windowMs ?? -1)} ms after the last Enter`,
  );
  const enter = await enterAtEnd(chrome, base, schema);
  report(enter.ok, `Enter at end ${schema}: ${enter.text}`);
  return results;
}

async function main() {
  const { checkMarkers } = await import(
    path.join(REPO, 'demo/src/pages/pdf-markers.ts')
  );
  const pdfText = await loadPdfText();
  if (flag('--pdf-dir'))
    return checkFolder(flag('--pdf-dir'), pdfText, checkMarkers);

  const profile = args[0];
  if (!profile || profile.startsWith('--')) {
    console.error(
      'usage: node scripts/pages-print-check.cjs <tmpProfileDir> [...]',
    );
    process.exit(2);
  }
  const base = flag('--base') || 'http://localhost:5174/';
  const only = flag('--only')?.split(',');
  const { PAGES_FIXTURES_META } = await import(
    path.join(REPO, 'demo/src/fixtures/pages/meta.ts')
  );
  const fixtures = PAGES_FIXTURES_META.filter((f) =>
    only ? only.includes(f.id) : !f.perfOnly,
  );
  const pdfDir = path.join(profile, 'pdfs');
  fs.mkdirSync(pdfDir, { recursive: true });

  const rows = [];
  const extra = [];
  const runInvariants = args.includes('--invariants');
  for (const schema of ['v2', 'v1']) {
    // The schema is stamped once per new doc, so each gets its own profile.
    const chrome = await openChrome(path.join(profile, schema));
    await chrome.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    try {
      if (runInvariants) {
        extra.push(...(await invariants(chrome, base, schema)));
      }
      for (const f of runInvariants ? [] : fixtures) {
        for (const paper of ['a4', 'letter']) {
          const cases = [{ id: f.id, schema, paper }];
          if (f.landscape)
            cases.push({ id: f.id, schema, paper, landscape: true });
          for (const c of cases) {
            let row;
            try {
              row = await runCase(
                chrome,
                base,
                c,
                pdfText,
                checkMarkers,
                pdfDir,
              );
            } catch (e) {
              row = {
                ...c,
                result: 'ERROR',
                problems: [String(e.message || e).slice(0, 200)],
              };
            }
            rows.push(row);
            console.log(
              `${row.result.padEnd(5)} ${c.id} ${c.schema} ${c.paper}${
                c.landscape ? ' landscape' : ''
              }  sheets ${row.sheets ?? '-'}  markers ${row.markers ?? '-'}  pages ${
                row.pages ?? '-'
              }  parity ${row.parity ?? '-'}  settle ${row.settle ?? '-'}`,
            );
            (row.problems || []).forEach((p) => console.log(`        ${p}`));
          }
        }
      }
      if (!runInvariants && (!only || only.includes('01'))) {
        const zoom = await zoomCheck(chrome, base, schema);
        extra.push(zoom.ok);
        console.log(
          `${zoom.ok ? 'PASS' : 'FAIL'}  zoom (fixture 01, ${schema}, A4): ${zoom.text}`,
        );
      }
      if (chrome.errors.length) {
        console.log(
          `page errors (${schema}): ${chrome.errors.slice(0, 3).join(' | ')}`,
        );
        if (chrome.errors.some((e) => e.includes('ddoc pagination'))) {
          extra.push(false);
        }
      }
    } finally {
      await chrome.close();
    }
  }
  const failed = rows.filter((r) => r.result !== 'PASS');
  const extraFailed = extra.filter((ok) => !ok).length;
  console.log(
    `\n${rows.length - failed.length}/${rows.length} cases passed, ${
      extra.length - extraFailed
    }/${extra.length} other checks. PDFs in ${pdfDir}`,
  );
  process.exit(failed.length || extraFailed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
