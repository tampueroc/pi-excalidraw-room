/**
 * Manual harness: load the extension with a stub ExtensionAPI, then drive its
 * tools against a live room and write the snapshot to /tmp.
 *   node scripts/try-tools.cjs "<room-url>"
 */
const { writeFileSync } = require("node:fs");
const { createJiti } = require("jiti");

(async () => {
  const link = process.argv[2];
  if (!link) {
    console.error('usage: node scripts/try-tools.cjs "<room-url>"');
    process.exit(2);
  }

  const jiti = createJiti(__filename, { interopDefault: true });
  const mod = await jiti.import("../src/index.ts");
  const tools = new Map();
  mod.default({
    registerTool: (tool) => tools.set(tool.name, tool),
    registerCommand: () => {},
    on: () => {},
  });

  const call = (name, params = {}) =>
    tools.get(name).execute(`call-${name}`, params, undefined, undefined, { cwd: process.cwd() });
  const text = (result) => result.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

  console.log("—", text(await call("excalidraw_join", { link })));

  console.log(
    "—",
    text(
      await call("excalidraw_draw_graph", {
        nodes: [
          { id: "gw", label: "API Gateway", backgroundColor: "#a5d8ff" },
          { id: "svc", label: "Services", shape: "diamond", backgroundColor: "#b2f2bb" },
          { id: "cache", label: "Redis", shape: "ellipse", backgroundColor: "#ffec99" },
          { id: "db", label: "PostgreSQL", shape: "ellipse", backgroundColor: "#ffc9c9" },
        ],
        edges: [
          { from: "gw", to: "svc", label: "HTTP" },
          { from: "svc", to: "cache", label: "read" },
          { from: "svc", to: "db", label: "SQL" },
        ],
        replace: true,
      }),
    ),
  );

  const read = await call("excalidraw_read", {});
  console.log("— scene:\n" + text(read));
  const serviceIds = (read.details.elements ?? []).map((el) => el.id);
  void serviceIds;

  const sceneIds = text(read)
    .split("\n")
    .filter((line) => /^- (diamond|ellipse)/.test(line))
    .map((line) => line.split(" ")[2]);

  console.log("—", text(await call("excalidraw_frame", { name: "Services layer", elementIds: sceneIds })));

  const snapshot = await call("excalidraw_snapshot", { maxWidth: 1100 });
  const image = snapshot.content.find((c) => c.type === "image");
  if (image) {
    writeFileSync("/tmp/try-tools.png", Buffer.from(image.data, "base64"));
    console.log("—", text(snapshot), "→ /tmp/try-tools.png");
  }

  console.log("—", text(await call("excalidraw_leave")));
})().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
