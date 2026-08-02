import type { Config } from "tailwindcss";
import path from "node:path";

// Tailwind resolves relative content globs against process.cwd(), not against
// this file. `next dev <dir>` is launched with the project as an argument
// rather than by cd-ing into it, so "./src/**" matched zero files and every
// utility got purged — the app rendered as unstyled HTML in dev while
// production builds were fine. Anchoring the glob to this file's own
// directory makes it work however the process is started.
// fast-glob needs forward slashes, including on Windows.
const srcGlob = path.join(__dirname, "src").replace(/\\/g, "/") + "/**/*.{ts,tsx}";

const config: Config = {
  content: [srcGlob],
  theme: {
    extend: {
      colors: {
        // Nahdet Misr CI: royal navy blue + bookstore teal
        brand: {
          50: "#eef1fb",
          100: "#dfe4f7",
          200: "#c4cdf0",
          300: "#9fade5",
          400: "#7385d8",
          500: "#5163cb",
          600: "#3d4bbd",
          700: "#3340a8",
          800: "#2b3990",
          900: "#273381",
          950: "#151c4e",
        },
        gold: "#4e7f76",
      },
      fontFamily: {
        sans: ["var(--font-cairo)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
