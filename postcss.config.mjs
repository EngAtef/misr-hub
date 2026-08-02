import path from "node:path";
import { fileURLToPath } from "node:url";

// Tailwind looks for tailwind.config.* in process.cwd(). `next dev <dir>` is
// launched with the project passed as an argument instead of by cd-ing into
// it, so the config was never found in dev: Tailwind fell back to its default
// (empty `content`), purged every utility, and the app rendered as unstyled
// HTML — buttons with no background or padding looked like plain text.
// Production builds happened to run from the project root, which is why only
// dev was affected. Pointing at the config explicitly makes both paths work
// regardless of the working directory.
const dir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    tailwindcss: { config: path.join(dir, "tailwind.config.ts") },
    autoprefixer: {},
  },
};

export default config;
