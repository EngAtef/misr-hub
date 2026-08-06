const React = require("react");
const { renderToString } = require("react-dom/server");
const path = require("path"), fs = require("fs");

const clientPath = require.resolve("./out/lib/supabase/client.js");
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true,
  exports: { createClient: () => ({ rpc: async () => ({ data: null }) }) } };
global.window = { location: { search: "" }, addEventListener() {}, removeEventListener() {} };
global.document = { addEventListener() {}, removeEventListener() {}, documentElement: { style: {}, dir: "rtl", lang: "ar" }, body: {} };
global.localStorage = { getItem: () => null, setItem() {} };

const seedByName = (code, name, expr) => {
  const anchor = "const [" + name + ",";
  const i = code.indexOf(anchor);
  if (i === -1) throw new Error("state not found: " + name);
  const open = code.indexOf("useState)(", i);
  const close = code.indexOf(")", open + "useState)(".length);
  return code.slice(0, open + "useState)(".length) + expr + code.slice(close);
};

const mode = process.argv[2] || "connected";
const overview = {
  total_clicks: 18422, links_total: 64, links_with_clicks: 41, links_tagged: 38,
  last_sync: "2026-08-05T18:00:00Z",
  daily: [{ date: "2026-07-01", clicks: 420 }, { date: "2026-07-02", clicks: 510 }, { date: "2026-07-03", clicks: 388 }],
  top_links: [
    { id: "bit.ly/nm-lugz", link: "https://bit.ly/nm-lugz", title: "لغز — يوليو", long_url: "https://nahdetmisrbookstore.com/ar/product/lugz?utm_campaign=CON%20l%202%20ad%20set%20l%20%D9%84%D9%8A%D9%85%D9%88%D9%86%20%D9%86%D8%B9%D9%86%D8%AA%D8%A7%D8%B9%20-%20T&utm_content=%D9%84%D9%8A%D9%85%D9%88%D9%86", utm_campaign: "CON l 2 ad set l ليمون نعنتاع - T", utm_content: "ليمون", clicks: 5120 },
    { id: "bit.ly/nm-365", link: "https://bit.ly/nm-365", title: null, long_url: "https://nahdetmisrbookstore.com/ar/product/365", utm_campaign: null, utm_content: null, clicks: 2210 },
  ],
  referrers: [{ value: "facebook.com", clicks: 9100 }, { value: "direct", clicks: 4300 }, { value: "instagram.com", clicks: 2900 }],
  countries: [{ value: "EG", clicks: 16800 }, { value: "SA", clicks: 900 }],
};
const chain = [
  { campaign_name: "CON l 2 ad set l ليمون نعنتاع - T", bitlinks: 1, spend: 17152.66, meta_clicks: 2742, meta_landing_views: 1085, bitly_clicks: 5120, ga4_sessions: 900, ga4_orders: 12, store_revenue: 8400, bitly_vs_meta: 1.87, ga4_vs_bitly: 0.18, verdict: "landing_lost" },
  { campaign_name: "CON l JUL l - kalam saleem", bitlinks: 2, spend: 8259.2, meta_clicks: 1185, meta_landing_views: 354, bitly_clicks: 420, ga4_sessions: 380, ga4_orders: 5, store_revenue: 2100, bitly_vs_meta: 0.35, ga4_vs_bitly: 0.9, verdict: "clicks_lost" },
  { campaign_name: "CON l adv june l 365 l 500", bitlinks: 1, spend: 12462.77, meta_clicks: 3281, meta_landing_views: 1298, bitly_clicks: 3100, ga4_sessions: 2400, ga4_orders: 30, store_revenue: 21000, bitly_vs_meta: 0.94, ga4_vs_bitly: 0.77, verdict: "healthy" },
];

let src = fs.readFileSync(path.join(__dirname, "out/components/ads-links.js"), "utf8");
src = seedByName(src, "connected", mode === "connected" ? "true" : "false");
src = seedByName(src, "overview", mode === "connected" ? "SEED_OV" : "null");
src = seedByName(src, "chain", mode === "connected" ? "SEED_CHAIN" : "[]");
src = seedByName(src, "loading", "false");
const pre = `const SEED_OV=${JSON.stringify(overview)};const SEED_CHAIN=${JSON.stringify(chain)};\n`;
fs.writeFileSync(path.join(__dirname, "out/components/ads-links.seeded.js"), pre + src);

const { LangProvider } = require("./out/lib/i18n.js");
const { AdsLinks } = require("./out/components/ads-links.seeded.js");
try {
  const html = renderToString(React.createElement(LangProvider, null,
    React.createElement(AdsLinks, { from: "2026-07-01", to: "2026-07-31" })));
  console.log(`LINKS [${mode}]: OK — ${html.length} chars`);
  if (process.env.DUMP) {
    const text = html.replace(/<\/(td|th|div|h3|span|p|a)>/g, " | ").replace(/<[^>]+>/g, "").replace(/[ \t]+/g, " ").replace(/(\s*\|\s*)+/g, " | ");
    console.log(text.slice(Number(process.env.FROM || 0), Number(process.env.FROM || 0) + 1500));
  }
} catch (e) {
  console.log(`LINKS [${mode}]: FAILED — ${e.message}`);
  console.log(e.stack.split("\n").slice(1, 5).join("\n"));
  process.exitCode = 1;
}
