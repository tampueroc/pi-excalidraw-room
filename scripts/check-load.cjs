/**
 * Loads the extension the way Pi does (jiti, host-provided typebox) with a stub
 * ExtensionAPI, and prints the registered tool and command names.
 *   node scripts/check-load.cjs
 */
const { createJiti } = require("/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs");

(async () => {
  const jiti = createJiti(__filename, { interopDefault: true });
  const mod = await jiti.import("../src/index.ts");
  const tools = [];
  const commands = [];
  const events = [];
  const pi = {
    registerTool: (tool) => tools.push(tool.name),
    registerCommand: (name) => commands.push(name),
    on: (event) => events.push(event),
  };
  mod.default(pi);
  console.log("tools:", tools.join(", "));
  console.log("commands:", commands.map((c) => "/" + c).join(", "));
  console.log("events:", events.join(", ") || "(none)");
})();
