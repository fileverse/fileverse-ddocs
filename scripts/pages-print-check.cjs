/* Pages mode M0 gate: does Chrome's print break pages where the screen says?
 * (docs/PAGES_MODE.md §6.3)
 *
 * Usage:
 *   cd demo && npx vite --port 5174       # in another terminal
 *   npm i --no-save pdfjs-dist@4.10.38     # once; kept out of package.json
 *   node scripts/pages-print-check.cjs "$(mktemp -d)" [--base http://localhost:5174/] [--only 01,04]
 *   node scripts/pages-print-check.cjs --pdf-dir <folder>   # PDFs printed by hand, debug markers on
 *
 * Each case loads a fixture in a real (headless) Chrome, checks screen vs
 * print-root block heights, prints to PDF with §Pn§ markers on every predicted
 * page start, and reads them back: page n must carry exactly §Pn§.
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
// page (already ready) can still answer.
const waitReady = (ev, doc, fixture) =>
  ev(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 60000;
    const tick = () => {
      const q = new URLSearchParams(location.search);
      const isThisPage =
        q.get('doc') === ${JSON.stringify(doc)} &&
        q.get('pagesFixture') === ${JSON.stringify(fixture)};
      if (isThisPage && window.__ddocPages?.ready) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('fixture never ready'));
      setTimeout(tick, 150);
    };
    tick();
  })`);

async function runCase(chrome, base, c, pdfText, checkMarkers, pdfDir) {
  // One doc per schema: the schema is stamped when a doc is created.
  const query = new URLSearchParams({
    doc: `pages-m0-${c.schema}`,
    pagesFixture: c.id,
    paper: c.paper,
  });
  if (c.landscape) query.set('orientation', 'landscape');
  if (c.schema === 'v1') query.set('v1', '1');
  await chrome.send('Page.navigate', { url: `${base}?${query}` });
  await waitReady(chrome.ev, `pages-m0-${c.schema}`, c.id);

  const stamp = await chrome.ev(
    `window.__ddoc.current.getYdoc().getMap('ddocMeta').get('schemaVersion') ?? null`,
  );
  const schema = stamp === 2 ? 'v2' : 'v1';
  if (schema !== c.schema) {
    return { ...c, result: 'SKIP', problems: [`schema stamp ${stamp}`] };
  }
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
  const markers = checkMarkers(pages, breaks.pageCount);
  const problems = [
    ...(parity.ok
      ? []
      : parity.mismatches
          .slice(0, 2)
          .map(
            (m) =>
              `parity #${m.index} ${m.tag} screen ${m.screen} print ${m.print} "${m.text}"`,
          )),
    ...markers.problems.slice(0, 2),
  ];
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
  return {
    ...c,
    parity: parity.ok ? 'ok' : `${parity.mismatches.length} diff`,
    pages: `${breaks.pageCount}/${pages.length}`,
    result: markers.ok && parity.ok ? 'PASS' : 'FAIL',
    problems,
  };
}

async function zoomCheck(chrome, base) {
  await chrome.send('Page.navigate', {
    url: `${base}?doc=pages-m0-v2&pagesFixture=01&paper=a4`,
  });
  await waitReady(chrome.ev, 'pages-m0-v2', '01');
  const at = async (zoom) => {
    await chrome.ev(`window.__ddocPages.setZoomLevel(${JSON.stringify(zoom)})`);
    await sleep(1200);
    const b = await chrome.ev('window.__ddocPages.breaks()');
    return JSON.stringify({ breaks: b.breaks, pageStarts: b.pageStarts });
  };
  const one = await at('1');
  const results = [];
  for (const zoom of ['1.5', 'fit', '0.75']) {
    results.push(`${zoom}: ${(await at(zoom)) === one ? 'same' : 'DIFFERENT'}`);
  }
  await at('1');
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
  const fixtures = PAGES_FIXTURES_META.filter(
    (f) => !only || only.includes(f.id),
  );
  const pdfDir = path.join(profile, 'pdfs');
  fs.mkdirSync(pdfDir, { recursive: true });

  const rows = [];
  for (const schema of ['v2', 'v1']) {
    // The schema is stamped once per new doc, so each gets its own profile.
    const chrome = await openChrome(path.join(profile, schema));
    try {
      for (const f of fixtures) {
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
              }  parity ${row.parity ?? '-'}  pages ${row.pages ?? '-'}`,
            );
            (row.problems || []).forEach((p) => console.log(`        ${p}`));
          }
        }
      }
      if (schema === 'v2' && (!only || only.includes('01'))) {
        console.log(
          `zoom (fixture 01, v2, A4): ${(await zoomCheck(chrome, base)).join(', ')}`,
        );
      }
      if (chrome.errors.length) {
        console.log(
          `page errors (${schema}): ${chrome.errors.slice(0, 3).join(' | ')}`,
        );
      }
    } finally {
      await chrome.close();
    }
  }
  const failed = rows.filter((r) => r.result !== 'PASS');
  console.log(
    `\n${rows.length - failed.length}/${rows.length} passed. PDFs in ${pdfDir}`,
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
