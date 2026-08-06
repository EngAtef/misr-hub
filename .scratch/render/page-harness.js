const React = require("react");
const { renderToString } = require("react-dom/server");
const path = require("path"), fs = require("fs");
const clientPath = require.resolve("./out/lib/supabase/client.js");
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true,
  exports: { createClient: () => ({ rpc: async () => ({ data: [] }), from: () => ({ select: async () => ({ data: [] }) }) }) } };
global.window = { location: { search: "" }, addEventListener() {}, removeEventListener() {} };
global.document = { addEventListener() {}, removeEventListener() {}, documentElement: { style: {}, dir: "rtl", lang: "ar" }, body: {} };
global.localStorage = { getItem: () => null, setItem() {} };
const seedByName = (code, name, expr) => {
  const i = code.indexOf("const [" + name + ",");
  if (i === -1) throw new Error("state not found: " + name);
  const open = code.indexOf("useState)(", i);
  const close = code.indexOf(")", open + "useState)(".length);
  return code.slice(0, open + "useState)(".length) + expr + code.slice(close);
};
const periods = [{ import_id:"i1", account_label:"kids", period_start:"2026-07-01", period_end:"2026-07-31", period_key:"2026-07-01_2026-07-31", period_label:"01 Jul - 31 Jul 2026", days:31, row_count:104, ad_rows:53, spend:161227.54, reported_purchases:864, reported_value:548187.7, file_name:"kids.xlsx", imported_at:"2026-08-05T10:00:00Z", imported_by_email:"a@b.com" }];
const base = { import_id:"i1", level:"ad", period_start:"2026-07-01", period_end:"2026-07-31", period_key:"2026-07-01_2026-07-31", days:31, map_source:"ad", book_units:0, att_units:0, book_net_revenue:0, book_delivered_revenue:0, book_buyers:0, book_avg_price:0, att_net_revenue:0, att_cancelled_orders:0, cost_per_lpv:0, cost_per_atc:0, cost_per_ic:0, cvr:0 };
const rows = [{ ...base, id:"r1", account_label:"kids", campaign_name:"CON l 2 ad set l ليمون نعنتاع - T", adset_name:"ADV", ad_name:"ليمون", delivery_status:"active", reach:119880, impressions:389774, frequency:3.25, spend:17152.66, cpm:44, link_clicks:2742, ctr_all:1.46, landing_page_views:1085, adds_to_cart:1636, checkouts_initiated:307, purchases:111, conversion_value:58484.23, cost_per_purchase:154.5, results_roas:3.41, cpc:6.26, lp_rate:39.6, atc_rate:150.8, ic_rate:18.8, purchase_rate:36.2, reported_roas:3.41, daily_spend:553, book_label:"لغز", book_skus:["C020926221363P"], book_orders:300, book_revenue:73815, book_cancelled_orders:15, book_stock:142, spend_share:1, att_orders:300, att_revenue:73815, actual_roas:2.35, net_roas:2.31, actual_cpa:104, cancel_rate:4.8 }];
const src0 = fs.readFileSync(path.join(__dirname, "out/app/(app)/ads/page.js"), "utf8");
let fails = 0;
for (const tab of ["overview","ads","books","gap","links","funnel","compare","mapping","imports"]) {
  let s = src0;
  s = seedByName(s, "periods", "SEED_P"); s = seedByName(s, "rows", "SEED_R");
  s = seedByName(s, "loading", "false"); s = seedByName(s, "tab", JSON.stringify(tab));
  s = seedByName(s, "selPeriods", "SEED_SP");
  const pre = `const SEED_P=${JSON.stringify(periods)};const SEED_R=${JSON.stringify(rows)};const SEED_SP=${JSON.stringify([periods[0].period_key])};\n`;
  const f = path.join(__dirname, `out/app/(app)/ads/page.t.js`);
  fs.writeFileSync(f, pre + s);
  delete require.cache[require.resolve(f)];
  try {
    const Page = require(f).default;
    const { LangProvider } = require("./out/lib/i18n.js");
    const html = renderToString(React.createElement(LangProvider, null, React.createElement(Page)));
    console.log(`  ${tab}: OK (${html.length})`);
  } catch (e) { fails++; console.log(`  ${tab}: FAILED — ${e.message}`); }
}
process.exitCode = fails ? 1 : 0;
