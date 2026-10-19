## Demo 

`npm run build`

### How the demo keeps a doc

By default the demo works the way ddocs.new does: the doc lives only in the
package's y-indexeddb store. The demo reads the store before mounting and
passes what it holds as `initialContent` (with `isNewDocument={false}`), uses
`onLocalChange` instead of `onChange`, and shows `onIndexedDbError` as a
toast. A host must pass the stored body: an editor left to load a store by
itself builds before it knows the doc's schema, and a schema-2 doc (`?v2=1`
here) loses its text.

Add `?localCopy=1` to the URL (keep the `doc` param) for the older host
behaviour: the demo keeps its own `localStorage` copy, saved through
`onChange`, and passes it back as `initialContent`. Use it to check that hosts
which still pass `onChange` behave as before.
