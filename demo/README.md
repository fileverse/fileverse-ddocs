## Demo 

`npm run build`

### How the demo keeps a doc

By default the demo works the way ddocs.new does: the doc lives only in the
package's y-indexeddb store. The demo reads the store before mounting, passes
no `initialContent` for a doc the store holds (with `isNewDocument={false}`),
uses `onLocalChange` instead of `onChange`, and shows `onIndexedDbError` as a
toast.

Add `?localCopy=1` to the URL (keep the `doc` param) for the older host
behaviour: the demo keeps its own `localStorage` copy, saved through
`onChange`, and passes it back as `initialContent`. Use it to check that hosts
which still pass `onChange` behave as before.
