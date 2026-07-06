import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
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
