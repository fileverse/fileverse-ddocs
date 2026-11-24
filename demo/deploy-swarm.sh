#!/usr/bin/env bash
# Deploy the demo app itself to Ethereum Swarm as a static website.
#
# Builds the demo with relative asset paths and the Bee API baked in, then
# uploads the bundle as a Swarm collection (manifest with an index
# document). The printed /bzz URL serves the app straight from the network —
# app code, images, documents and version history all live on Swarm.
#
# The upload is *synchronous* (`swarm-deferred-upload: false`): the call
# only returns once the chunks have been pushed out to the network. Bee's
# default is deferred, which stores locally and syncs in the background —
# fine for private data, wrong for a site meant to be opened by others,
# because stopping the node before that finishes leaves the content
# unretrievable everywhere else. It makes the upload slower and it is worth
# it: a visitor's node hangs indefinitely looking for chunks nobody serves.
#
# Usage:  BEE_API_URL=http://localhost:1633 ./deploy-swarm.sh
#         SWARM_POSTAGE_BATCH_ID=<id>  pins a batch (else auto-discovered).
#         SWARM_DEFERRED=true          opt back into background syncing.
#         VITE_CONFIG=<file>           override the vite config.
set -euo pipefail
cd "$(dirname "$0")"

BEE_API_URL="${BEE_API_URL:-http://localhost:1633}"
SWARM_DEFERRED="${SWARM_DEFERRED:-false}"

if [ -z "${SWARM_POSTAGE_BATCH_ID:-}" ]; then
  SWARM_POSTAGE_BATCH_ID=$(curl -sf "$BEE_API_URL/stamps" |
    python3 -c 'import json,sys; print(next(s["batchID"] for s in json.load(sys.stdin)["stamps"] if s["usable"]))')
fi
echo "Bee node:      $BEE_API_URL"
echo "Postage batch: $SWARM_POSTAGE_BATCH_ID"

echo "Building demo (base ./, Swarm storage enabled)..."
VITE_BEE_API_URL="$BEE_API_URL" npx vite build \
  ${VITE_CONFIG:+--config "$VITE_CONFIG"} --base ./

echo "Uploading to Swarm (synchronous — this waits for network sync)..."
TARBALL=$(mktemp)
trap 'rm -f "$TARBALL"' EXIT
tar -C dist -cf "$TARBALL" .

REFERENCE=$(curl -sf --max-time 3600 -X POST "$BEE_API_URL/bzz" \
  -H "content-type: application/x-tar" \
  -H "swarm-postage-batch-id: $SWARM_POSTAGE_BATCH_ID" \
  -H "swarm-index-document: index.html" \
  -H "swarm-collection: true" \
  -H "swarm-deferred-upload: $SWARM_DEFERRED" \
  --data-binary @"$TARBALL" |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["reference"])')

# Ask the node whether the network can actually serve this back. A site
# that uploaded fine but is not retrievable looks, to a visitor, exactly
# like a site that is merely slow — for as long as they are willing to wait.
echo "Checking the network can retrieve it..."
RETRIEVABLE=$(curl -sf --max-time 600 "$BEE_API_URL/stewardship/$REFERENCE" |
  python3 -c 'import json,sys; print(json.load(sys.stdin).get("isRetrievable"))' ||
  echo "unknown")

echo
echo "Deployed:    $BEE_API_URL/bzz/$REFERENCE/"
echo "Retrievable: $RETRIEVABLE"
if [ "$RETRIEVABLE" != "True" ]; then
  echo
  echo "WARNING: the network does not report this as retrievable yet."
  echo "Keep this node running so it can finish serving the chunks, then"
  echo "re-check, or force a re-upload to the network with:"
  echo "  curl -X PUT $BEE_API_URL/stewardship/$REFERENCE"
fi
echo "(Point an ENS contenthash or a feed at this reference for a stable address.)"
