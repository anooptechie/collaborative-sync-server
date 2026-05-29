import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node, // Tells ESLint this is a Node.js environment
        console: "readonly" // Explicitly allows console.log in tests
      }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
    }
  },
  {
    // Files to completely ignore from linting rules (like third-party or load tests if preferred)
    ignores: ["node_modules/", "dist/"]
  }
);