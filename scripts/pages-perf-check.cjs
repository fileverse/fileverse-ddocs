/* Pages mode performance check (docs/PAGES_MODE.md §12.9, §12.12 item 6).
 *
 * Usage:
 *   cd demo && npx vite --port 5174       # in another terminal
 *   node scripts/pages-perf-check.cjs "$(mktemp -d)" [--base http://localhost:5174/]
 *     [--fixture 11] [--v1] [--no-has] [--passes 5]
 *
 * Loads the fixture (A4) in Pageless and in Pages in a headless Chrome, types
 * 200 characters mid-document through Input.insertText, 50 ms apart, and
 * traces the renderer's main thread. A keystroke's time is the main-thread
 * tasks from its beforeinput to the next one's, the same in both modes. Then,
 * in Pages, Enter near the top (so every spacer moves) and a forced pass, a
 * few times: the ddoc:pagination:* measures and the style recalc of each pass.
 * --no-has deletes the `.editor-main-lane:has(...)` rules first (§12.9).
 * Every trace is saved in the profile folder (open it in DevTools).
 *
 * Budgets: Pages keystroke <= 1.10 x Pageless, extra per keystroke < 1 ms,
 * collect + place < 50 ms, emit < 16 ms.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const WebSocket = require(path.join(REPO, 'node_modules/ws'));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9382;
const KEYSTROKES = 200;
const SPACING_MS = 50;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const listeners = new Map();
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
    if (m.method) listeners.get(m.method)?.(m.params);
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
  const on = (method, fn) => listeners.set(method, fn);
  await send('Runtime.enable');
  await send('Page.enable');
  const close = async () => {
    ws.close();
    chrome.kill();
    await sleep(800);
  };
  return { send, ev, on, close };
}

const waitReady = (ev, search) =>
  ev(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 120000;
    const tick = () => {
      const isThisPage = location.search === ${JSON.stringify(`?${search}`)};
      if (isThisPage && window.__ddocPages?.ready) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('fixture never ready'));
      setTimeout(tick, 150);
    };
    tick();
  })`);

// Pages: until no pass is pending. Pageless: two frames.
const waitSettled = (ev) =>
  ev(`new Promise((resolve) => {
    const deadline = Date.now() + 60000;
    const frames = () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const tick = async () => {
      const p = window.__ddocPages.pass();
      if (!p || !p.settled) {
        if (Date.now() < deadline) return setTimeout(tick, 50);
      }
      await frames();
      resolve(window.__ddocPages.pass());
    };
    tick();
  })`);

const editorJs = 'window.__ddoc.current.getEditor()';

// Every `.editor-main-lane:has(...)` rule, inside @container/@media too.
const DROP_HAS = `(() => {
  let n = 0;
  const walk = (list) => {
    for (let i = list.cssRules.length - 1; i >= 0; i -= 1) {
      const rule = list.cssRules[i];
      if (rule.cssRules && !rule.selectorText) walk(rule);
      else if (/editor-main-lane:has\\(/.test(rule.selectorText || '')) {
        list.deleteRule(i);
        n += 1;
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try { walk(sheet); } catch { /* cross-origin */ }
  }
  return n;
})()`;

let navigations = 0;
async function open(chrome, base, { fixture, schema, mode }) {
  const query = new URLSearchParams({
    doc: `pages-perf-${schema}-${mode}-${Date.now()}`,
    pagesFixture: fixture,
    paper: 'a4',
  });
  if (schema === 'v1') query.set('v1', '1');
  if (mode === 'pageless') query.set('mode', 'pageless');
  query.set('n', String((navigations += 1)));
  await chrome.send('Page.navigate', { url: `${base}?${query}` });
  await waitReady(chrome.ev, query.toString());
  await waitSettled(chrome.ev);
  await sleep(1500);
  await waitSettled(chrome.ev);
}

// Caret in the middle of the textblock at the middle of the doc.
const caretMid = (ev) =>
  ev(`(() => {
    const ed = ${editorJs};
    const half = ed.state.doc.content.size / 2;
    let at = null;
    ed.state.doc.descendants((node, pos) => {
      if (at !== null || !node.isTextblock || pos + node.nodeSize < half) return;
      if (node.content.size > 40) at = pos + 1 + (node.content.size >> 1);
    });
    ed.commands.focus(at);
    return at;
  })()`);

const caretNearTop = (ev) =>
  ev(`(() => {
    const ed = ${editorJs};
    let seen = 0;
    let at = null;
    ed.state.doc.descendants((node, pos) => {
      if (at === null && node.isTextblock && ++seen === 3) at = pos + node.nodeSize - 1;
    });
    ed.commands.focus(at);
    return at;
  })()`);

let traceDir = null;
let traces = 0;
async function trace(chrome, body) {
  const events = [];
  chrome.on('Tracing.dataCollected', (p) => events.push(...p.value));
  const done = new Promise((r) => chrome.on('Tracing.tracingComplete', r));
  await chrome.send('Tracing.start', {
    categories: 'toplevel,devtools.timeline,blink.user_timing',
    transferMode: 'ReportEvents',
  });
  await body();
  await chrome.send('Tracing.end');
  await done;
  if (traceDir) {
    fs.writeFileSync(
      path.join(traceDir, `trace-${(traces += 1)}.json`),
      JSON.stringify({ traceEvents: events }),
    );
  }
  return events;
}

// Top-level tasks and style recalcs on the page's main thread.
function mainThread(events, markName) {
  const threads = events.filter(
    (e) => e.ph === 'M' && e.name === 'thread_name',
  );
  const marks = events.filter((e) => e.name === markName);
  const pid = marks[0]?.pid;
  const tid = threads.find(
    (t) => t.pid === pid && t.args.name === 'CrRendererMain',
  )?.tid;
  const own = events.filter((e) => e.pid === pid && e.tid === tid);
  const tasks = own
    .filter((e) => e.name === 'ThreadControllerImpl::RunTask' && e.ph === 'X')
    .sort((a, b) => a.ts - b.ts);
  const styles = own.filter(
    (e) => e.name === 'UpdateLayoutTree' && e.ph === 'X',
  );
  return { tasks, styles };
}

const busy = (tasks, from, to) =>
  tasks
    .filter((t) => t.ts >= from && t.ts < to)
    .reduce((sum, t) => sum + t.dur, 0) / 1000;

// Each keystroke owns the tasks from the one holding its beforeinput up to
// the next keystroke's.
function keystrokeTimes(events) {
  const { tasks } = mainThread(events, 'perf:key');
  const keys = events
    .filter((e) => e.name === 'perf:key')
    .map((e) => e.ts)
    .sort((a, b) => a - b);
  const start = (ts) =>
    tasks.find((t) => t.ts <= ts && ts <= t.ts + t.dur)?.ts ?? ts;
  const starts = keys.map(start);
  const end = starts[starts.length - 1] + SPACING_MS * 1000;
  return starts.map((s, i) => busy(tasks, s, starts[i + 1] ?? end));
}

const pct = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  ];
};
const fmt = (n) => (n === undefined ? '-' : n.toFixed(2));

async function typeRun(chrome) {
  await caretMid(chrome.ev);
  await chrome.ev(`(() => {
    window.__perfMeasures = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.name.startsWith('ddoc:pagination:')) {
          window.__perfMeasures.push({ name: e.name, duration: e.duration });
        }
      }
    }).observe({ type: 'measure' });
    ${editorJs}.view.dom.addEventListener(
      'beforeinput',
      () => performance.mark('perf:key'),
      { capture: true },
    );
  })()`);
  await sleep(300);
  const text = 'the quick brown fox jumps over a lazy dog ';
  const events = await trace(chrome, async () => {
    for (let i = 0; i < KEYSTROKES; i += 1) {
      const t0 = Date.now();
      await chrome.send('Input.insertText', { text: text[i % text.length] });
      await sleep(Math.max(0, SPACING_MS - (Date.now() - t0)));
    }
    await sleep(1000);
    await waitSettled(chrome.ev);
  });
  const times = keystrokeTimes(events);
  const { tasks } = mainThread(events, 'perf:key');
  const first = events.find((e) => e.name === 'perf:key')?.ts;
  const total = busy(tasks, first, Infinity);
  const measures = await chrome.ev('window.__perfMeasures');
  return { times, total, measures };
}

// Measures in order, one pass per collect; the first pass is the trigger's.
function groupPasses(measures) {
  const passes = [];
  for (const m of measures) {
    const phase = m.name.split(':')[2];
    if (phase === 'collect') passes.push({ collect: 0, place: 0, emit: 0 });
    if (passes.length) passes[passes.length - 1][phase] = m.duration;
  }
  return passes;
}

// Enter near the top moves every spacer below it; the pass is then forced.
async function passRuns(chrome, count) {
  await caretNearTop(chrome.ev);
  await chrome.ev('window.__perfMeasures.splice(0)');
  const runs = [];
  for (let i = 0; i < count; i += 1) {
    const events = await trace(chrome, async () => {
      await chrome.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        text: '\r',
      });
      await chrome.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      });
      await chrome.ev(
        'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))',
      );
      await chrome.ev(`new Promise((resolve) => {
        performance.mark('perf:pass');
        ${editorJs}.storage.pagination.flush();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          performance.mark('perf:pass-end');
          resolve();
        }));
      })`);
    });
    const { styles } = mainThread(events, 'perf:pass');
    const from = events.find((e) => e.name === 'perf:pass')?.ts;
    const to = events.find((e) => e.name === 'perf:pass-end')?.ts;
    const styleMs = (list) => list.reduce((sum, s) => sum + s.dur, 0) / 1000;
    const style = styleMs(styles.filter((s) => s.ts >= from && s.ts < to));
    const measures = await chrome.ev('window.__perfMeasures.splice(0)');
    runs.push({
      ...groupPasses(measures)[0],
      style,
      withEnter: styleMs(styles),
      passes: groupPasses(measures).length,
    });
    await sleep(400);
  }
  return runs;
}

async function main() {
  const profile = args[0];
  if (!profile || profile.startsWith('--')) {
    console.error(
      'usage: node scripts/pages-perf-check.cjs <tmpProfileDir> [...]',
    );
    process.exit(2);
  }
  const base = flag('--base') || 'http://localhost:5174/';
  const fixture = flag('--fixture') || '11';
  const schema = args.includes('--v1') ? 'v1' : 'v2';
  const passCount = Number(flag('--passes') || 5);
  traceDir = profile;
  const chrome = await openChrome(path.join(profile, 'chrome'));
  await chrome.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const result = {};
  try {
    for (const mode of ['pageless', 'pages']) {
      await open(chrome, base, { fixture, schema, mode });
      if (args.includes('--no-has')) {
        console.log(
          `${mode}: dropped ${await chrome.ev(DROP_HAS)} :has() rules`,
        );
      }
      const pages = await chrome.ev(
        'window.__ddocPages.pass()?.pageCount ?? null',
      );
      const run = await typeRun(chrome);
      result[mode] = run;
      console.log(
        `${mode.padEnd(8)} keystroke median ${fmt(pct(run.times, 50))} ms, p95 ${fmt(
          pct(run.times, 95),
        )} ms, main thread ${fmt(run.total)} ms over ${run.times.length} keys${
          pages ? ` (${pages} pages)` : ''
        }`,
      );
      if (mode === 'pages') {
        const passes = run.measures.length
          ? `passes while typing: ${run.measures
              .map((m) => `${m.name.split(':')[2]} ${fmt(m.duration)}`)
              .join(', ')}`
          : 'no full pass while typing';
        console.log(`         ${passes}`);
        result.passes = await passRuns(chrome, passCount);
      }
    }
  } finally {
    await chrome.close();
  }
  const less = result.pageless;
  const more = result.pages;
  const ratio = pct(more.times, 50) / pct(less.times, 50);
  const extra = pct(more.times, 50) - pct(less.times, 50);
  console.log('\nForced passes (Enter near the top, then flush):');
  result.passes.forEach((r, i) =>
    console.log(
      `  ${i + 1}: collect ${fmt(r.collect)} place ${fmt(r.place)} emit ${fmt(
        r.emit,
      )} ms, style recalc ${fmt(r.style)} ms (with the Enter ${fmt(
        r.withEnter,
      )}) (${r.passes} passes)`,
    ),
  );
  const cp = result.passes.map((r) => r.collect + r.place);
  const emit = result.passes.map((r) => r.emit);
  const style = result.passes.map((r) => r.style);
  const checks = [
    [`keystroke median ratio ${ratio.toFixed(3)} <= 1.10`, ratio <= 1.1],
    [`extra per keystroke ${fmt(extra)} ms < 1`, extra < 1],
    [
      `collect+place median ${fmt(pct(cp, 50))} ms (max ${fmt(Math.max(...cp))}) < 50`,
      pct(cp, 50) < 50,
    ],
    [
      `emit median ${fmt(pct(emit, 50))} ms (max ${fmt(Math.max(...emit))}) < 16`,
      pct(emit, 50) < 16,
    ],
  ];
  console.log(`  style recalc per pass median ${fmt(pct(style, 50))} ms\n`);
  checks.forEach(([text, ok]) =>
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${text}`),
  );
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
module.exports = { openChrome, open, caretNearTop, editorJs, DROP_HAS };
