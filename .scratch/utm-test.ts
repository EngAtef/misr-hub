import { parseDestination } from "../src/lib/bitly/api.ts";

const cases: [string, string | null][] = [
  ["https://nahdetmisrbookstore.com/ar/product/lugz?utm_source=facebook&utm_medium=paid-social&utm_campaign=CON%20l%20JUL%20l%20-%205at%20-500%20-%20video&utm_content=5at", "CON l JUL l - 5at -500 - video"],
  ["https://nahdetmisrbookstore.com/ar/c/kids?utm_campaign=CON+l+JUNE+l+-+BRAIN&utm_content=%D8%A7%D9%84%D8%B9%D8%A7%D8%A8+%D8%A7%D9%84%D8%B9%D9%82%D9%84", "CON l JUNE l - BRAIN"],
  ["https://nahdetmisrbookstore.com/ar/product/x", null],
  ["not a url at all", null],
  ["", null],
];
let pass = 0;
for (const [url, expected] of cases) {
  const got = parseDestination(url).utm_campaign;
  const ok = got === expected;
  pass += ok ? 1 : 0;
  console.log(ok ? "PASS" : "FAIL", JSON.stringify(url.slice(0, 55)), "->", JSON.stringify(got), ok ? "" : `(expected ${JSON.stringify(expected)})`);
}
const full = parseDestination(cases[0][0]);
console.log("full parse:", JSON.stringify({ src: full.utm_source, med: full.utm_medium, content: full.utm_content, host: full.dest_host, path: full.dest_path }));
console.log(`${pass}/${cases.length} passed`);
