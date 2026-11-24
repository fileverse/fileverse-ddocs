# Demo

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

## Ethereum Swarm storage (optional)

The demo can keep images and documents on
[Ethereum Swarm](https://www.ethswarm.org/), encrypted in the browser. Point it
at a Bee node before starting it, from this directory (`demo/`), which is its
own Vite project:

```bash
cd demo && npm i
VITE_BEE_API_URL=http://localhost:1633 npx vite
```

Or open it in a browser that injects `window.swarm` (Freedom); then the
browser's own node is used, and nothing needs configuring. There the page
asks for access once, and the browser asks before the first save: to
publish, and to sign with an identity it keeps for this site. Saving needs
that identity and storage on the browser's node; until both are there the
document stays in this browser and a notice says what is missing.

- **Images** go through `imageUploadFn` / `imageFetchFn`.
- **Documents** are saved as versions on a Swarm feed: after an edit (or a
  title change) the demo reads the doc's y-indexeddb store and uploads it as
  the next version, skipping saves that change nothing. A doc this browser's
  store does not hold, such as one opened from a link in another browser, is
  restored from its latest version before the editor mounts. The Swarm tag
  in the navbar opens the version history: preview any version, or restore
  it as the latest. `?swarmVersion=N` links to a version.
- The URL fragment carries the doc's keys, so the address bar is the share
  link. That holds for docs made over a Bee node, whose link carries the
  feed's own key: it opens anywhere, and in a `window.swarm` browser
  read-only. A doc made in a `window.swarm` browser lives on the feed of
  that browser's identity, which its link does not name, so it opens only
  there.
- Edits made while Swarm cannot be written (no postage batch, node stopped)
  stay in the browser and go out when it can.
- Document versions are saved in the default store mode only; with
  `?localCopy=1` only images go to Swarm.

The first usable postage batch on the node is auto-discovered; pin a
specific one with `VITE_SWARM_POSTAGE_BATCH_ID=<batch id>`. A node with no
batch still reads: the demo runs read-only and offers to buy one in-app.

## Hosting the demo itself on Swarm

The demo is a static bundle, so the *app* can live on Swarm alongside the
data — no web server at all:

```bash
./deploy-swarm.sh
```

This builds with relative paths, uploads the bundle as a Swarm website
(manifest + index document) and prints a `/bzz/<reference>/` URL served by
your Bee node. App code, images, document snapshots and version history
then all come from the Swarm network. Point an ENS `contenthash` (or a
feed) at the reference for a stable, human-readable address.
