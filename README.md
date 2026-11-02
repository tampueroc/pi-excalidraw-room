# pi-excalidraw-room

A native Pi extension that joins a live Excalidraw collaboration room, so an agent can
read the diagram a person has open in the browser and edit it in place.

**Status: milestone M5** — join, read, add, update, move, delete, connect, snapshot,
persistence and `.excalidraw` import/export. See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md); the product
description is [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md).

## Requirements

- Node.js 22+
- Pi coding agent
- A self-hosted Excalidraw with live collaboration
  (verified against [`tampueroc/excalidraw-collaboration`](https://github.com/tampueroc/excalidraw-collaboration):
  frontend `:80`, storage `:8081`, Socket.IO relay `:8082`)

## Run it

```bash
npm install
pi -e ./src/index.ts
```

Then, in Pi:

```text
/excalidraw join http://127.0.0.1/#room=<roomId>,<roomKey>
```

The room URL holds the room id **and its encryption key**: treat it as a secret, and never
commit it or paste it into a log.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `EXCALIDRAW_URL` | `http://127.0.0.1` | Excalidraw frontend |
| `EXCALIDRAW_RELAY_URL` | `http://127.0.0.1:8082` | Socket.IO relay |
| `EXCALIDRAW_ORIGIN` | `EXCALIDRAW_URL` | HTTP Origin sent on the handshake |
| `EXCALIDRAW_AGENT_NAME` | `pi-agent` | Name people see in the room |
| `EXCALIDRAW_ROOM_LINK` | – | Join this room on session start |
| `EXCALIDRAW_STORAGE_URL` | `http://127.0.0.1:8081/api/v2` | Scene persistence; set empty to disable |
| `EXCALIDRAW_SNAPSHOT_FONT` | first system sans found | TTF used to draw labels in `excalidraw_snapshot` |
| `EXCALIDRAW_TRANSPORT` | `websocket` | `websocket` or `polling` |
| `EXCALIDRAW_ROOM_DEBUG` | – | `1` prints protocol diagnostics to stderr |

## Commands and tools

| Command | Description |
|---|---|
| `/excalidraw join <url>` | Join a room |
| `/excalidraw leave` | Disconnect |
| `/excalidraw status` | Connection, peers, scene size |
| `/excalidraw open` | Reopen the current room in the browser |

| Tool | Description |
|---|---|
| `excalidraw_join` | Join a room (explicit link or `EXCALIDRAW_ROOM_LINK`) |
| `excalidraw_leave` | Disconnect |
| `excalidraw_status` | Connection, peers, scene source and version |
| `excalidraw_read` | Elements with labels, positions, size and scene bounds |
| `excalidraw_add` | Create rectangles, ellipses, diamonds and text, optionally labelled |
| `excalidraw_update` | Move, resize, recolour or relabel an element |
| `excalidraw_delete` | Delete elements (bound text goes with them) |
| `excalidraw_connect` | Bound arrow between two elements |
| `excalidraw_move` | Move elements by a delta; labels and bound arrows follow |
| `excalidraw_snapshot` | Render the scene to a PNG the agent can look at |
| `excalidraw_export` | Write the scene to a `.excalidraw` file |
| `excalidraw_import` | Load a `.excalidraw` file, remapping ids into the room |

## Development

```bash
npm run check                          # tsc --noEmit
node --test src/**/*.test.ts           # unit tests
EXCALIDRAW_E2E=1 node --test tests/   # live relay + a fake browser peer
node scripts/check-load.cjs            # load the extension the way Pi does
node scripts/inspect.ts "<room-url>" 5 # print a live scene

# examples/architecture.excalidraw imports into any room:
#   excalidraw_import path=examples/architecture.excalidraw
```

## Snapshots

`excalidraw_snapshot` returns a PNG the model can see. It is not a screenshot of the
browser: the scene is handed to Excalidraw's own `exportToSvg` (0.18 accepts a synthetic
`document`, so it runs in Node), then rasterised with `@resvg/resvg-wasm`. Shapes, arrows
and roughness are Excalidraw's; glyph advance widths are approximated because there is no
canvas to measure with, and the font of an exported SVG is replaced by a system font.

Those dependencies are loaded lazily — a session that never asks for a picture pays
nothing for `jsdom` or `@excalidraw/excalidraw`.

## Persistence

The relay stores nothing: a fresh join always finds an empty room. Scenes survive reloads
through the deployment's storage backend, the same `PUT /api/v2/rooms/:id` the browser
uses — body `uint32BE(sceneVersion) ‖ iv ‖ AES-GCM(roomKey, elements)`. The agent loads the
stored scene when it is first in the room, writes one second after the last change, and
flushes on leave. `excalidraw_status` reports `persisted`, `lastPersistedAt` and any
`persistError`.

## License

MIT.
