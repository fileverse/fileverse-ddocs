# ddocs.new integration handoff (M3)

For the person doing the ddocs.new side of the flat-schema rollout. The
file-level inventory lives in `TEC2515_REMAINING.md` section 3 and the
`FLAT_SCHEMA_V2.md` spec; this document explains how the pieces behave
together, per user journey, and in what order things must happen. Nothing
here supersedes those two, it narrates them.

## The mental model: one question, asked once

Every document answers one question: **which schema does it use?** The answer
is decided once, at the moment the document is born, and stamped inside the
document itself (`ydoc.getMap('ddocMeta').get('schemaVersion')`). Every later
open just reads the stamp.

On editor mount the package checks the Y.Doc:

- **Stamp present, or doc has content** → that document's schema is settled.
  No stamp + content = pre-marker legacy doc = v1. The prop below is ignored
  entirely. Nothing the app does can change an existing document's schema.
- **No stamp and the doc is empty** → the document is being born right now.
  This is the only moment `preferredSchemaVersion` is consulted. If it says 2,
  the package writes the stamp (origin `'self'`, so no spurious save) and the
  doc is flat forever.

"Creation fork" means exactly that: a single if, evaluated once per document,
at birth. The road is one-way.

Because the stamp travels inside the content blob, everything downstream is
automatic: duplication copies the stamp, sharing sends it, IPFS restore keeps
it, a collaborator's client reads it and builds the matching editor. Dexie
needs no schema change; `IDdoc.version` (crypto/contract) is unrelated.

## The flag

```
flags.ts: flatSchemaEnabled          prod: false | staging, preview: true
        ↓
<DdocEditor preferredSchemaVersion={flatSchemaEnabled ? 2 : 1} ... />
        ↓  consulted only for a brand-new empty doc
stamp written into the Y.Doc
        ↓  every open, forever
stamp → extension set (dBlock or flat)
```

The flag never decides any existing document's schema; it only decides what
the next newborn is stamped with. Consequences worth internalizing:

- Flipping prod on: new docs are born v2 from that second; every existing doc,
  including one created a minute earlier, is untouched.
- Flipping prod back off (emergency): new docs go back to v1. The v2 docs
  created in between keep working, their stamp governs them. Rollback is a
  config change, not a deploy, and it never strands data.
- Staging and prod can disagree indefinitely. Mixed v1/v2 libraries are the
  normal state, not a transition artifact.
- Package default is 1 so no other consumer gets v2 by accident on a version
  bump. The flag is the same protection one layer up, for ddocs.new itself.

## The app changes (details in TEC2515_REMAINING.md §3)

1. **Package upgrade** to the release cut from #552. The app pins the exact
   version; keep the `yjs` / `y-indexeddb` / `y-protocols` overrides in
   lockstep with the package's peers.
2. **The prop**, gated by the flag, at the `<DdocEditor>` mount.
3. **Title extraction** (`utils/ddoc-title-manager.ts:120-180`) — the app's
   own copy of the wrapper-shape assumption. On v2 it fails *silently* and
   every doc stays "Untitled" (doc list, export filenames). The package fixed
   its identical copy in `package/utils/extract-title-from-content.tsx`;
   reuse that shape. **Must land before any v2 doc exists.**
4. **Version-history diff** — verified to need NO code change. The pipeline
   is schema-agnostic end to end: `buildVersionDiffSnapshot` decodes blobs
   via `yDocToProsemirrorJSON` (no schema involved), the LCS differ compares
   whatever block types it is given, and the renderer's dBlock branch at
   `utils/diff/node-diff-renderer.ts:272` is a v1-only refinement that flat
   content simply never enters. v2 diffs actually align better than v1:
   persistent blockId attrs give the LCS block identity, where v1's
   attr-less dBlock wrappers are interchangeable. Characterization tests
   lock the flat path (`utils/diff/__tests__/node-diff-flat.test.ts` in the
   app repo). Cross-schema diff still cannot occur (a doc never changes
   schema).
5. **Templates** (`use-create-page.tsx`) — the app converts its template
   JSON to a Yjs blob headlessly, before any editor mounts. Pass
   `{ schemaVersion: 2 }` to the package's `getYjsConvertor()` when the flag
   says v2; the package builds the flat editor, unwraps the dBlock wrappers,
   and stamps the marker inside the blob itself. The stamp must be born
   there: a headless blob already has content at first real mount, so the
   mount-time stamping refuses it, and an unstamped blob is legacy v1
   forever. Never hand-rewrite `template-utils.ts` (144 dBlock nodes); the
   v1-shaped JSON stays the source of truth. Note the in-editor template
   overlay needs nothing — it already unwraps at insert time against the
   live schema. The `.md`/`.docx` import paths (`getYjsContentFromMarkdown`
   / `getYjsContentFromDocx`) still build v1 blobs — safe (imported docs
   simply stay v1), thread the same option through them when imports should
   produce v2 docs.
6. **E2E selectors** (`tests/utils/selectors.ts:13`) couple to v1 node-view
   DOM; add v2 variants.

Everything else is verified opaque: Dexie, IPFS publish, collab transport,
comments, search, AI, key rotation all pass the blob through byte-level.

## User journeys after the flip

| Journey | What happens |
|---|---|
| Old user opens a legacy doc | No stamp → v1 extensions → identical behavior, indefinitely. No migration. |
| Same user creates a new doc | Born v2. Their library is mixed v1/v2; every surface picks per-doc by stamp. |
| New user | Only ever sees v2, templates included. |
| Viewer / public page | Blob → stamp → right extension set. v2 read-only collapse/copy-link chrome exists (widget decorations). |
| Collaborator joins | Transport opaque; their client reads the stamp. See the hazard below. |
| Blog user (.md) | Markdown serialization is package-side, parity-verified (20/20 sweep). |
| Split View | Right pane is the real editor; parity-verified. |
| Version history | Per-doc single schema; works once the diff renderer has its flat branch. |
| Duplicate a doc | Stamp travels in the blob; schema preserved for free. |

## The journey that can destroy data

A stale browser tab running an old bundle has no concept of schema versions.
If it opens a v2 doc, it parses flat content with dBlock rules and writes that
structure back through Yjs: corruption, synced to everyone, no undo. This
cannot be fixed retroactively for code already running in someone's browser.

Hence the one hard ordering rule, and the reason it is rigid:

1. **Ship the guard release** (any release cut from #552; the guard is
   dormant) and deploy ddocs.new with it. Let it **soak for weeks** so the
   stale-tab population turns over. Clients with the guard refuse
   newer-than-supported docs and show "refresh to update".
2. **Test collaboration against v2** — the one unverified area in the package
   work. Nothing today can create a v2 collab doc, so this needs deliberate
   setup on staging with the flag on.
3. **Only then flip the prod flag.**

The soak time, not the code, is the schedule's long pole. That is the
argument for merging #552 and cutting the guard release early, while
everything else proceeds in parallel.

## Sequence checklist

- [ ] Merge #552, cut a package release (guard now exists in a published version)
- [ ] ddocs.new: upgrade package + land fixes 3-6 above, flag OFF everywhere
- [ ] Deploy to prod (all dormant), start the soak clock
- [ ] Flag ON in staging/preview; run the journey table above, especially collab
- [ ] Title check: create v2 doc with an H1, confirm doc list + export filename
- [ ] Version history on a v2 doc with several versions
- [ ] Soak elapsed + collab verified → flip prod flag
- [ ] Later, once irreversible in practice: delete the flag, hardcode 2
