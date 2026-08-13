/* v1 vs v2 parity sweep.
 *
 * Usage:
 *   npx vite demo          # in another terminal, must be on :5173
 *   node scripts/parity-sweep.cjs "$(mktemp -d)" myrun
 *
 * Drives a v1 document and a v2 document through the SAME scripted actions in
 * a real browser and compares normalised results; anything that differs is a
 * candidate bug. Each check must return a value that is schema-INDEPENDENT
 * (text, counts, markdown, booleans) - never raw JSON, which legitimately
 * differs between the two shapes.
 *
 * A check that returns null/{}/'' is worthless: it will "match" trivially.
 * Several early versions of these checks passed against an empty document
 * before they were fixed, so always eyeball the values, not just the verdict.
 */
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9370;
const BASE = 'http://localhost:5173/';

const getJson = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d)));
  }).on('error', rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Each check: { name, script } evaluated in the page, returns a comparable value.
const CHECKS = [
  {
    name: 'export-markdown',
    script: `(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.setContent('');
      e.commands.insertContent('<h1>Title</h1><p>Para with <strong>bold</strong>.</p><ul><li>one</li><li>two</li></ul><blockquote>quote</blockquote>');
      await new Promise(r => setTimeout(r, 600));
      const md = await e.commands.exportMarkdownFile({ title: 'doc', returnMDFile: true, includeStyles: false });
      return String(md).replace(/^---[\\s\\S]*?---/, '').trim();
    })()`,
  },
  {
    name: 'export-html-text',
    script: `(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.setContent('');
      e.commands.insertContent('<h2>Head</h2><p>text <em>em</em></p><ul><li>li</li></ul><blockquote>q</blockquote><pre><code>code</code></pre>');
      await new Promise(r => setTimeout(r, 700));
      const html = e.getHTML();
      // Strip tags/attrs: compare the readable text and the tag vocabulary.
      const tags = [...new Set((html.match(/<([a-z0-9]+)/gi) || []).map(t => t.slice(1).toLowerCase()))]
        .filter(t => t !== 'div').sort().join(',');
      return { text: e.state.doc.textContent.trim(), tags };
    })()`,
  },
  {
    name: 'title-extraction',
    script: `(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.setContent('');
      e.commands.insertContent('<p>lead in</p><h1>Real Document Title</h1><p>body</p>');
      await new Promise(r => setTimeout(r, 700));
      const mod = await import('/@fs${REPO}/package/utils/extract-title-from-content.tsx');
      return mod.extractTitleFromContent({ content: e.getJSON().content });
    })()`,
  },
  {
    name: 'character-word-count',
    script: `(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.setContent('');
      e.commands.insertContent('<h1>Counting</h1><p>one two three four</p><ul><li>five six</li></ul>');
      await new Promise(r => setTimeout(r, 700));
      const cc = e.storage.characterCount;
      return { chars: cc.characters(), words: cc.words() };
    })()`,
  },
  {
    name: 'table-of-contents',
    script: `(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.setContent('');
      e.commands.insertContent('<h1>Alpha</h1><p>a</p><h2>Beta</h2><p>b</p><h3>Gamma</h3>');
      await new Promise(r => setTimeout(r, 800));
      e.commands.updateTableOfContents && e.commands.updateTableOfContents();
      await new Promise(r => setTimeout(r, 600));
      const toc = e.storage.tableOfContents?.content || [];
      return toc.map(i => (i.textContent || '') + '#' + i.level).join('|');
    })()`,
  },
  {
    name: 'comments-set-and-mark',
    script: `(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.setContent('');
      e.commands.insertContent('<p>comment target text</p>');
      await new Promise(r => setTimeout(r, 500));
      let from = null, to = null;
      e.state.doc.descendants((n, p) => {
        if (from === null && n.type.name === 'paragraph' && n.textContent.includes('comment target')) {
          from = p + 1; to = p + 1 + n.content.size;
        }
      });
      e.commands.setTextSelection({ from, to });
      const ok = e.commands.setComment('test-comment-1');
      await new Promise(r => setTimeout(r, 400));
      let marked = 0;
      e.state.doc.descendants((n) => {
        if (n.isText && n.marks.some(m => m.type.name === 'comment')) marked++;
      });
      const dom = document.querySelectorAll('.inline-comment, [data-comment-id]').length;
      return { commandReturned: Boolean(ok), markedTextNodes: marked, domNodes: dom > 0 };
    })()`,
  },
  {
    name: 'search-and-replace',
    script: `(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.setContent('');
      e.commands.insertContent('<p>needle here</p><p>another needle</p>');
      await new Promise(r => setTimeout(r, 500));
      e.commands.setSearchTerm('needle');
      e.commands.setReplaceTerm('pin');
      await new Promise(r => setTimeout(r, 400));
      const results = e.storage.searchAndReplace?.results?.length ?? null;
      e.commands.replaceAll();
      await new Promise(r => setTimeout(r, 600));
      return { results, textAfter: e.state.doc.textContent.trim() };
    })()`,
  },
  {
    name: 'undo-redo',
    script: `(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.setContent('');
      e.commands.insertContent('<p>base</p>');
      await new Promise(r => setTimeout(r, 900));
      const base = e.state.doc.textContent.trim();
      e.commands.focus('end');
      // Separate history step: insertContent right after setContent can be
      // merged into one undo entry, which would undo everything.
      await new Promise(r => setTimeout(r, 900));
      e.commands.insertContent(' added');
      await new Promise(r => setTimeout(r, 400));
      const afterType = e.state.doc.textContent.trim();
      e.commands.undo();
      await new Promise(r => setTimeout(r, 400));
      const afterUndo = e.state.doc.textContent.trim();
      e.commands.redo();
      await new Promise(r => setTimeout(r, 400));
      const afterRedo = e.state.doc.textContent.trim();
      return { base, afterType, afterUndo, afterRedo,
               undoWorked: afterUndo === base, redoWorked: afterRedo === afterType };
    })()`,
  },
  {
    name: 'copy-paste-roundtrip',
    script: `(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.setContent('');
      e.commands.insertContent('<h2>Head</h2><p>body one</p><ul><li>li a</li></ul>');
      await new Promise(r => setTimeout(r, 600));
      e.commands.selectAll();
      const slice = e.state.selection.content();
      const before = { blocks: e.state.doc.childCount, text: e.state.doc.textContent.trim() };
      // Paste the copied slice at the end.
      e.commands.setTextSelection(e.state.doc.content.size);
      e.view.dispatch(e.state.tr.replaceSelection(slice));
      await new Promise(r => setTimeout(r, 700));
      const after = { blocks: e.state.doc.childCount, text: e.state.doc.textContent.trim() };
      return { beforeText: before.text, blocksAdded: after.blocks - before.blocks,
               textDoubled: after.text.includes(before.text) && after.text.length > before.text.length };
    })()`,
  },
  {
    name: 'lists-indent-outdent',
    script: `(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.setContent('');
      e.commands.insertContent('<ul><li>first</li><li>second</li></ul>');
      await new Promise(r => setTimeout(r, 500));
      let liPos = null, count = 0;
      e.state.doc.descendants((n, p) => {
        if (n.type.name === 'listItem') { count++; if (count === 2) liPos = p + 2; }
      });
      e.commands.setTextSelection(liPos);
      const sunk = e.commands.sinkListItem('listItem');
      await new Promise(r => setTimeout(r, 400));
      const nested = (() => { let d = 0; e.state.doc.descendants((n, p, parent, i) => {
        if (n.type.name === 'bulletList') d++; }); return d; })();
      const lifted = e.commands.liftListItem('listItem');
      await new Promise(r => setTimeout(r, 400));
      const afterLift = (() => { let d = 0; e.state.doc.descendants((n) => {
        if (n.type.name === 'bulletList') d++; }); return d; })();
      return { sunk, nestedListCount: nested, lifted, afterLiftListCount: afterLift,
               text: e.state.doc.textContent.trim() };
    })()`,
  },
  {
    name: 'markdown-to-slides',
    script: `(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.setContent('');
      e.commands.insertContent('<h1>Slide One</h1><p>a</p><h1>Slide Two</h1><p>b</p>');
      await new Promise(r => setTimeout(r, 700));
      const mod = await import('/@fs${REPO}/package/utils/md-to-slides.ts');
      const md = await mod.convertToMarkdown(e);
      const slides = mod.processMarkdownContent(md);
      const keys = Object.keys(slides || {});
      return { slideCount: keys.length,
               firstSlideHasHeading: /Slide One/.test(JSON.stringify(slides)),
               mdHeadings: (md.match(/^# /gm) || []).length };
    })()`,
  },
  {
    name: 'presentation-mode-render',
    script: `(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.setContent('');
      e.commands.insertContent('<h1>Deck</h1><p>content</p>');
      await new Promise(r => setTimeout(r, 500));
      // Headless render check: the document text must survive a read-only pass.
      e.setEditable(false);
      await new Promise(r => setTimeout(r, 400));
      const readOnlyText = document.querySelector('.ProseMirror')?.textContent?.trim();
      e.setEditable(true);
      await new Promise(r => setTimeout(r, 300));
      return { readOnlyText };
    })()`,
  },
  {
    name: 'slash-insert-commands',
    script: `(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.setContent('');
      e.commands.insertContent('<p>x</p>');
      await new Promise(r => setTimeout(r, 400));
      const mod = await import('/@fs${REPO}/package/utils/insert-commands.ts');
      const cmds = mod.insertCommands || mod.default;
      const names = [];
      const out = {};
      for (const key of ['heading1', 'bulletList', 'codeBlock', 'blockquote', 'todoList', 'table', 'divider', 'callout']) {
        const cmd = Array.isArray(cmds) ? cmds.find(c => (c.id || c.name || '').toLowerCase().includes(key.toLowerCase().slice(0, 5))) : null;
        if (cmd) names.push(key);
      }
      // Drive the generic node commands directly instead (schema-facing part).
      e.commands.focus('end');
      e.chain().focus().toggleHeading({ level: 1 }).run();
      out.heading = e.isActive('heading', { level: 1 });
      e.chain().focus().toggleHeading({ level: 1 }).run();
      e.chain().focus().toggleBulletList().run();
      out.bulletList = e.isActive('bulletList');
      e.chain().focus().toggleBulletList().run();
      e.chain().focus().toggleCodeBlock().run();
      out.codeBlock = e.isActive('codeBlock');
      e.chain().focus().toggleCodeBlock().run();
      e.chain().focus().toggleBlockquote().run();
      out.blockquote = e.isActive('blockquote');
      e.chain().focus().toggleBlockquote().run();
      e.chain().focus().toggleTaskList().run();
      out.taskList = e.isActive('taskList');
      return out;
    })()`,
  },
  {
    name: 'block-actions-duplicate-delete',
    script: `(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.setContent('');
      e.commands.insertContent('<p>alpha</p><p>beta</p>');
      await new Promise(r => setTimeout(r, 500));
      const startBlocks = e.state.doc.childCount;
      // Duplicate the first top-level block via NodeSelection, mirroring the menu.
      e.commands.setNodeSelection(0);
      const node = e.state.selection.node;
      e.commands.insertContentAt(node.nodeSize, node.toJSON());
      await new Promise(r => setTimeout(r, 500));
      const afterDup = e.state.doc.childCount;
      e.commands.setNodeSelection(0);
      e.commands.deleteSelection();
      await new Promise(r => setTimeout(r, 500));
      return { startBlocks, added: afterDup - startBlocks,
               afterDelete: e.state.doc.childCount, text: e.state.doc.textContent.trim() };
    })()`,
  },
  {
    name: 'tables-create-and-edit',
    script: `(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.setContent('');
      e.commands.insertContent('<p>x</p>');
      await new Promise(r => setTimeout(r, 400));
      e.commands.focus('end');
      e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      await new Promise(r => setTimeout(r, 700));
      const count = (t) => { let n = 0; e.state.doc.descendants((x) => { if (x.type.name === t) n++; }); return n; };
      const initial = { table: count('table'), row: count('tableRow'), cell: count('tableCell'), header: count('tableHeader') };
      e.chain().focus().addRowAfter().run();
      await new Promise(r => setTimeout(r, 400));
      const afterRow = count('tableRow');
      e.chain().focus().addColumnAfter().run();
      await new Promise(r => setTimeout(r, 400));
      const afterCol = count('tableCell') + count('tableHeader');
      e.chain().focus().deleteTable().run();
      await new Promise(r => setTimeout(r, 400));
      return { initial, afterRow, afterCol, tablesAfterDelete: count('table'),
               domTables: document.querySelectorAll('.ProseMirror table').length };
    })()`,
  },
  {
    name: 'page-break-and-print-dom',
    script: `(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.setContent('');
      e.commands.insertContent('<p>before</p>');
      await new Promise(r => setTimeout(r, 400));
      e.commands.focus('end');
      e.commands.setPageBreak && e.commands.setPageBreak();
      await new Promise(r => setTimeout(r, 500));
      e.commands.focus('end');
      e.commands.insertContent('<p>after</p>');
      await new Promise(r => setTimeout(r, 500));
      let breaks = 0;
      e.state.doc.descendants((n) => { if (n.type.name === 'pageBreak') breaks++; });
      return { breaks, text: e.state.doc.textContent.trim(),
               domBreaks: document.querySelectorAll('.ProseMirror [data-type=\\'page-break\\'], .ProseMirror .page-break').length };
    })()`,
  },
  {
    name: 'suggestion-mode-marks',
    script: `(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.setContent('');
      e.commands.insertContent('<p>suggest over this text</p>');
      await new Promise(r => setTimeout(r, 500));
      let from = null, to = null;
      e.state.doc.descendants((n, p) => {
        if (from === null && n.type.name === 'paragraph' && n.textContent.includes('suggest over')) {
          from = p + 1; to = p + 1 + n.content.size;
        }
      });
      e.commands.setTextSelection({ from, to });
      // The suggestion pipeline rides the same highlight + comment marks.
      const hl = e.chain().focus().setHighlight({ color: 'var(--color-inline-comment)' }).run();
      await new Promise(r => setTimeout(r, 400));
      let highlighted = 0;
      e.state.doc.descendants((n) => {
        if (n.isText && n.marks.some(m => m.type.name === 'highlight')) highlighted++;
      });
      return { applied: Boolean(hl), highlightedTextNodes: highlighted,
               text: e.state.doc.textContent.trim() };
    })()`,
  },
  {
    name: 'split-view-markdown-serialize',
    script: `(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.setContent('');
      e.commands.insertContent('<h2>Sync</h2><p>line one</p><ul><li>a</li></ul>');
      await new Promise(r => setTimeout(r, 700));
      const mod = await import('/@fs${REPO}/package/utils/md-to-slides.ts');
      const md = await mod.convertToMarkdown(e);
      return md.trim();
    })()`,
  },
  {
    name: 'media-node-insert',
    script: `(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.setContent('');
      e.commands.insertContent('<p>x</p>');
      await new Promise(r => setTimeout(r, 400));
      e.commands.focus('end');
      const px = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      e.commands.insertContentAt(e.state.doc.content.size, {
        type: 'resizableMedia', attrs: { src: px, 'media-type': 'img', width: 100, height: 100 },
      });
      await new Promise(r => setTimeout(r, 800));
      let media = 0;
      e.state.doc.descendants((n) => { if (n.type.name === 'resizableMedia') media++; });
      return { mediaNodes: media, domImgs: document.querySelectorAll('.ProseMirror img').length,
               blocks: e.state.doc.childCount };
    })()`,
  },
  {
    name: 'columns-layout',
    script: `(async () => {
      const e = window.__ddoc.current.getEditor();
      e.commands.setContent('');
      e.commands.insertContent('<p>x</p>');
      await new Promise(r => setTimeout(r, 400));
      e.commands.focus('end');
      e.commands.setColumns && e.commands.setColumns(2);
      await new Promise(r => setTimeout(r, 800));
      const count = (t) => { let n = 0; e.state.doc.descendants((x) => { if (x.type.name === t) n++; }); return n; };
      e.commands.insertContent('typed in column');
      await new Promise(r => setTimeout(r, 500));
      return { columns: count('columns'), column: count('column'),
               text: e.state.doc.textContent.trim(),
               domCols: document.querySelectorAll('.ProseMirror [data-type=\\'column\\']').length };
    })()`,
  },
];

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.argv[2]}`,
    '--no-first-run', '--window-size=1400,900', 'about:blank',
  ]);
  process.on('exit', () => chrome.kill());
  let targets = null;
  for (let i = 0; i < 30; i++) { try { targets = await getJson('/json/list'); break; } catch { await sleep(500); } }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256e6 });
  await new Promise((r) => ws.on('open', r));
  let msgId = 0; const pending = new Map(); const pageErrors = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push((m.params.exceptionDetails.exception?.description || '').slice(0, 120));
    }
  });
  const send = (method, params = {}) =>
    new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, timeout: 120000 });
    if (r.result.exceptionDetails) {
      return { __error: JSON.stringify(r.result.exceptionDetails).slice(0, 220) };
    }
    return r.result.result.value;
  };
  const nav = async (url) => {
    await send('Page.navigate', { url });
    await ev(`new Promise((resolve, reject) => {
      const dl = Date.now() + 60000;
      const t = () => {
        if (window.__ddoc?.current?.getEditor?.()) return resolve(1);
        if (Date.now() > dl) return reject(new Error('not ready'));
        setTimeout(t, 120);
      };
      t();
    })`);
    await sleep(1100);
  };

  await send('Runtime.enable');
  const RUN = process.argv[3] || 'p1';
  const results = { v1: {}, v2: {} };

  for (const schema of ['v1', 'v2']) {
    for (const check of CHECKS) {
      // Fresh document per check so they cannot contaminate each other.
      await nav(`${BASE}?doc=${schema}-${check.name}-${RUN}${schema === 'v2' ? '&v2=1' : ''}`);
      results[schema][check.name] = await ev(check.script);
    }
  }

  const norm = (v) => JSON.stringify(v);
  const rows = CHECKS.map((c) => {
    const a = results.v1[c.name]; const b = results.v2[c.name];
    return { check: c.name, match: norm(a) === norm(b), v1: a, v2: b };
  });

  console.log(JSON.stringify({ rows, pageErrors }, null, 2));
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch((e) => { console.error('SWEEP-FAILED:', e.message); process.exit(1); });
