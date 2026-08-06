// Render the real Ads Center tree with real data. useEffect never fires under
// renderToString, so initial state is seeded by variable name.
const React = require("react");
const { renderToString } = require("react-dom/server");
const path = require("path");
const fs = require("fs");

const clientPath = require.resolve("./out/lib/supabase/client.js");
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true,
  exports: { createClient: () => ({ rpc: async () => ({ data: [] }), from: () => ({ select: async () => ({ data: [] }) }) }) } };

global.window = { location: { search: "" }, addEventListener() {}, removeEventListener() {} };
global.document = { addEventListener() {}, removeEventListener() {}, documentElement: { style: {}, dir: "rtl", lang: "ar" }, body: {} };
global.localStorage = { getItem: () => null, setItem() {} };

const src = fs.readFileSync(path.join(__dirname, "out/app/(app)/ads/page.js"), "utf8");
const tab = process.argv[2] || "overview";

// seed by state variable name — order-independent
const seedByName = (code, name, expr) => {
  const anchor = 'const [' + name + ',';
  const i = code.indexOf(anchor);
  if (i === -1) throw new Error('state not found: ' + name);
  const open = code.indexOf('useState)(', i);
  const close = code.indexOf(')', open + 'useState)('.length);
  return code.slice(0, open + 'useState)('.length) + expr + code.slice(close);
};

let patched = src;
patched = seedByName(patched, "periods", "SEED_PERIODS");
patched = seedByName(patched, "rows", "SEED_ROWS");
patched = seedByName(patched, "blended", "SEED_BLENDED");
patched = seedByName(patched, "topProducts", "SEED_PRODUCTS");
patched = seedByName(patched, "loading", "false");
patched = seedByName(patched, "tab", "SEED_TAB");
patched = seedByName(patched, "gapRows", "SEED_GAP");
patched = seedByName(patched, "selPeriods", "SEED_SELPERIODS");
if (patched === src) throw new Error("no seeds applied");

const preamble =
  `const SEED_ROWS=${JSON.stringify(require("./rows.json"))};` +
  `const SEED_PERIODS=${JSON.stringify(require("./periods.json"))};` +
  `const SEED_BLENDED=${JSON.stringify(require("./blended.json"))};` +
  `const SEED_PRODUCTS=${JSON.stringify(require("./products.json"))};` +
  `const SEED_GAP=${JSON.stringify(require("./gap.json"))};` +
  `const SEED_TAB=${JSON.stringify(tab)};` +
  `const SEED_SELPERIODS=${JSON.stringify([require("./periods.json")[0].period_key])};\n`;
fs.writeFileSync(path.join(__dirname, "out/app/(app)/ads/page.seeded.js"), preamble + patched);

const { LangProvider } = require("./out/lib/i18n.js");
const Page = require("./out/app/(app)/ads/page.seeded.js").default;

try {
  const html = renderToString(React.createElement(LangProvider, null, React.createElement(Page)));
  console.log(`TAB ${tab}: OK — ${html.length} chars`);
  if (process.env.DUMP) {
    const text = html.replace(/<\/(td|th|div|h3|span|p)>/g, " | ").replace(/<[^>]+>/g, "").replace(/[ \t]+/g, " ").replace(/(\s*\|\s*)+/g, " | ");
    console.log(text.slice(Number(process.env.FROM || 0), Number(process.env.FROM || 0) + 1800));
  }
} catch (e) {
  console.log(`TAB ${tab}: FAILED — ${e.message}`);
  console.log(e.stack.split("\n").slice(1, 6).join("\n"));
  process.exitCode = 1;
}
