import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        vam: {
          green: "#16834c",
          mint: "#e8f6ee",
          ink: "#14352a",
          line: "#dce9e2"
        }
      },
      boxShadow: {
        soft: "0 10px 24px rgba(20, 53, 42, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
