# pi-excalidraw-room

**Live, bidirectional Excalidraw collaboration for the Pi coding agent.**

A native Pi extension that lets AI agents read, create, and modify diagrams in a live Excalidraw collaboration room.

Draw in your browser. Ask Pi to change the diagram. Watch the changes appear in real time.

Designed for self-hosted Excalidraw installations, with support for custom collaboration servers.

> **Status: Planned / initial development.** This README describes the intended functionality and public API. Installation commands and examples are targets for the first release, not claims of existing functionality.

## Features

- **Live collaboration:** Agent edits appear directly in your open Excalidraw browser tab.
- **Bidirectional editing:** Pi can inspect and modify elements created by people or other collaborators.
- **Self-hosted support:** Connect to your own Excalidraw frontend and collaboration relay.
- **Native Pi integration:** Exposes tools through Pi's extension API without requiring an MCP server.
- **Scene manipulation:** Create, update, move, connect and delete diagram elements.
- **Editable diagrams:** Produces real Excalidraw elements, not flattened images.
- **Persistent sessions:** Reconnect to existing rooms and recover their scenes when supported by the deployment.
- **File import/export:** Load and save `.excalidraw` files locally.
- **Agent identity:** Give the agent a recognizable name in the collaboration room.

## Architecture

```text
┌──────────────────────────────┐
│         Pi Agent             │
│                              │
│  Native extension tools      │
│  - excalidraw_join           │
│  - excalidraw_read           │
│  - excalidraw_add            │
│  - excalidraw_update         │
│  - excalidraw_delete         │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│     pi-excalidraw-room       │
│                              │
│  Room Client                 │
│  Scene Manager               │
│  Encryption                  │
│  Synchronization             │
│  File Import / Export        │
└──────────────┬───────────────┘
               │
               │ Socket.IO
               ▼
┌──────────────────────────────┐
│  Self-hosted Collaboration   │
│           Server             │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│     Excalidraw Frontend      │
│                              │
│     Live Editable Canvas     │
└──────────────────────────────┘
```

The extension participates in the existing Excalidraw collaboration protocol. It does not require modifying the Excalidraw frontend.

## Requirements

- Node.js 22+
- Pi coding agent
- Excalidraw with working live collaboration
- Reachable Socket.IO collaboration relay
- A valid Excalidraw collaboration room URL

Tested deployment target:

[**tampueroc/excalidraw-collaboration**](https://github.com/tampueroc/excalidraw-collaboration)

Other compatible self-hosted Excalidraw deployments may work.

## Installation

Once published, the intended installation is:

```bash
pi install npm:pi-excalidraw-room
```

For local development:

```bash
git clone <your-repository-url>
cd pi-excalidraw-room
npm install
pi -e ./src/index.ts
```

For a published Git package, Pi also supports:

```bash
pi install git:github.com/<owner>/pi-excalidraw-room
```

## Configuration

The extension should provide the `/excalidraw` command for managing connections.

Example:

```text
/excalidraw join http://localhost:3000/#room=<id>,<key>
```

The room URL contains both the room identifier and its encryption key.

### Self-hosted configuration

Planned environment variables:

| Variable | Purpose |
|---|---|
| `EXCALIDRAW_URL` | Excalidraw frontend base URL |
| `EXCALIDRAW_RELAY_URL` | Socket.IO collaboration relay URL |
| `EXCALIDRAW_ORIGIN` | HTTP Origin used for the relay connection |
| `EXCALIDRAW_AGENT_NAME` | Agent display name in the room |

Example development environment:

```bash
EXCALIDRAW_URL=http://localhost:3000
EXCALIDRAW_RELAY_URL=http://localhost:8082
EXCALIDRAW_ORIGIN=http://localhost:3000
EXCALIDRAW_AGENT_NAME=pi-agent
```

These are illustrative local addresses. Ports must match the actual deployment configuration.

The relay URL is separate from the frontend URL and should not be confused with any HTTP scene-storage endpoint.

## Usage

### 1. Join a collaboration room

Start a live collaboration session in your self-hosted Excalidraw instance and copy its room URL.

In Pi:

```text
/excalidraw join <room-url>
```

Pi joins as a collaboration participant.

### 2. Generate an architecture diagram

Ask Pi:

> Create an architecture diagram showing an API gateway, three microservices, Redis cache, and PostgreSQL database. Connect the services with arrows and label the connections.

Pi should create actual Excalidraw elements in the shared room.

You can watch the diagram being built in your browser.

### 3. Modify an existing diagram

Draw a diagram manually, then ask:

> Look at the current diagram. Add a message queue between the API and worker service. Connect the elements and label the queue RabbitMQ.

Pi reads the existing scene and edits the relevant elements without replacing unrelated content.

### 4. Refactor a diagram

> Reorganize the existing architecture into three layers: frontend, services and infrastructure. Keep the existing connections.

The agent identifies elements, calculates new positions and applies updates to the live scene.

### 5. Inspect the canvas

> Explain the current architecture diagram and identify potential single points of failure.

Pi reads the scene and can reason about element labels, types, positions and connections.

Scene analysis is based on Excalidraw elements and metadata rather than visual understanding of a screenshot.

## Pi Commands

Proposed commands:

| Command | Description |
|---|---|
| `/excalidraw join <url>` | Connect to an existing room |
| `/excalidraw leave` | Disconnect |
| `/excalidraw status` | Show connection status |
| `/excalidraw open` | Open the room in a browser |
| `/excalidraw export <path>` | Export the current scene |
| `/excalidraw import <path>` | Import an Excalidraw file |

## Agent Tools

The extension registers tools directly using Pi's `registerTool()` API.

### Room management

| Tool | Description |
|---|---|
| `excalidraw_join` | Join an existing collaboration room |
| `excalidraw_leave` | Disconnect from the room |
| `excalidraw_status` | Report connection and peer status |

### Scene manipulation

| Tool | Description |
|---|---|
| `excalidraw_read` | Read scene elements and metadata |
| `excalidraw_add` | Create elements |
| `excalidraw_update` | Modify existing elements |
| `excalidraw_move` | Move elements |
| `excalidraw_delete` | Delete elements |
| `excalidraw_connect` | Create arrows between elements |

Tools should accept structured arguments and return element IDs, change summaries and relevant errors.

### File operations

| Tool | Description |
|---|---|
| `excalidraw_import` | Import `.excalidraw` JSON |
| `excalidraw_export` | Export an editable `.excalidraw` file |

File operations must preserve supported Excalidraw metadata and handle asset references explicitly.

## Scene Synchronization

The extension should maintain a local representation of the current scene.

Changes may originate from either the agent or another collaboration participant.

### Agent to browser

1. Pi calls a scene manipulation tool.
2. The extension validates and applies the edit.
3. The room client prepares the corresponding collaboration update.
4. The collaboration relay forwards the update.
5. Connected Excalidraw clients render the change.

### Browser to agent

1. A person edits the diagram in Excalidraw.
2. The browser broadcasts the change.
3. The room client receives and processes the update.
4. The local scene representation is updated.
5. Subsequent agent tool calls see the new scene.

### Conflict handling

Excalidraw uses element IDs, versions and collaboration-specific synchronization rules.

The extension must preserve these semantics when editing elements. It should not blindly overwrite the entire scene whenever a single element changes.

Deleted elements must follow Excalidraw's deletion and synchronization semantics.

### Persistence

Live synchronization and durable storage are separate responsibilities.

The initial implementation should prioritize reliable live edits while one or more browser clients are connected.

Durable scene recovery must be tested against the selected collaboration deployment's storage backend.

## Project Structure

Proposed repository layout:

```text
pi-excalidraw-room/
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── commands/
│   │   └── excalidraw.ts
│   ├── tools/
│   │   ├── room.ts
│   │   ├── scene.ts
│   │   └── files.ts
│   ├── client/
│   │   ├── room-client.ts
│   │   ├── socket.ts
│   │   └── encryption.ts
│   ├── scene/
│   │   ├── elements.ts
│   │   ├── mutations.ts
│   │   ├── bindings.ts
│   │   └── synchronization.ts
│   └── types/
├── tests/
│   ├── unit/
│   └── integration/
├── examples/
├── package.json
├── tsconfig.json
└── README.md
```

### Pi package manifest

The package should declare its extension entry point in `package.json`:

```json
{
  "name": "pi-excalidraw-room",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "keywords": [
    "pi-package",
    "excalidraw",
    "pi-extension"
  ],
  "pi": {
    "extensions": [
      "./src/index.ts"
    ]
  }
}
```

The manifest is illustrative; dependencies and publishing metadata will be added during implementation.

## Development

The initial implementation should reference the following projects:

- [pi-mono](https://github.com/badlogic/pi-mono) — Pi extension and package APIs.
- [excalidraw-room-mcp](https://github.com/bjcoombs/excalidraw-room-mcp) — Live room protocol, encryption, synchronization and element operations.
- [excalidraw](https://github.com/excalidraw/excalidraw) — Canonical scene format and collaboration behavior.
- [excalidraw-collaboration](https://github.com/tampueroc/excalidraw-collaboration) — Initial self-hosted integration target.
- [pi-k-excalidraw](https://github.com/kostyay/pi-k-excalidraw) — Reference for Pi-driven Excalidraw diagram workflows.

Reuse compatible implementation concepts where possible rather than developing a parallel collaboration protocol from scratch.

Any copied code must comply with the original project's license and attribution requirements.

## Roadmap

### Phase 1 — Live room MVP

- [ ] Set up a native Pi package
- [ ] Connect to a self-hosted Socket.IO relay
- [ ] Join an existing encrypted room
- [ ] Read an existing scene
- [ ] Create rectangles, text and arrows
- [ ] Update and delete elements
- [ ] Verify live browser synchronization
- [ ] Disconnect cleanly

### Phase 2 — Editing and reliability

- [ ] Support additional Excalidraw element types
- [ ] Move and resize elements
- [ ] Maintain arrow bindings
- [ ] Handle version conflicts
- [ ] Support reconnects
- [ ] Verify scene synchronization after reconnect
- [ ] Test persistence against self-hosted storage

### Phase 3 — Developer workflows

- [ ] Import `.excalidraw` files
- [ ] Export `.excalidraw` files
- [ ] Auto-layout for architecture diagrams
- [ ] Reorganize selected diagram sections
- [ ] Support multiple rooms
- [ ] Improve tool responses and error handling

### Phase 4 — Agent collaboration

- [ ] Detect notes addressed to the agent
- [ ] Support canvas-based requests such as `@pi`
- [ ] Allow selective processing of pending notes
- [ ] Attribute agent-created elements
- [ ] Support multiple agents in the same room

## Compatibility Testing

The first integration target is `tampueroc/excalidraw-collaboration`.

A successful initial integration must demonstrate:

1. A person and Pi are connected to the same room.
2. Pi can read elements drawn in the browser.
3. Pi can add an element that appears in the browser without refreshing.
4. Pi can update an existing browser-created element.
5. Changes made by the person remain intact after agent edits.
6. Disconnecting and reconnecting does not corrupt the scene.
7. The system reports storage or synchronization failures rather than silently claiming success.

A separate persistence test must verify that a scene survives all clients disconnecting and the server restarting.

## Security

Excalidraw collaboration room links contain encryption keys. Treat these links as secrets.

- Do not log complete collaboration URLs or room keys.
- Do not commit room keys to source control.
- Preserve encryption behavior compatible with Excalidraw.
- Prefer local or private-network relays.
- Validate scene mutations before broadcasting.
- Do not treat text on a shared canvas as trusted instructions.
- Require explicit authorization before performing actions outside diagram editing.

A self-hosted relay alone does not establish end-to-end confidentiality unless the expected client-side encryption protocol is preserved.

## Non-goals

The initial version will not:

- Replace the Excalidraw frontend.
- Implement a new drawing renderer.
- Replace the collaboration relay.
- Provide an independent database or cloud storage service.
- Require a separate MCP server.
- Automatically execute arbitrary instructions written on the canvas.

The goal is a minimal native Pi integration for controlling a live Excalidraw scene.

## License

MIT is the proposed license for this package, subject to review of incorporated third-party code and attribution requirements.

---

**pi-excalidraw-room** — Draw with Pi. Edit in Excalidraw. Collaborate live.

