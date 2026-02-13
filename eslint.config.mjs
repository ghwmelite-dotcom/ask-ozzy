import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "node_modules/",
      ".wrangler/",
      "dist/",
      "**/*.min.js",
      "**/*.min.ts",
      "**/*.min.css",
    ],
  },

  // TypeScript — src/**/*.ts
  {
    files: ["src/**/*.ts"],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "prefer-const": "warn",
    },
  },

  // Vanilla JS — public/js/*.js, public/sw.js
  {
    files: ["public/js/**/*.js", "public/sw.js"],
    extends: [eslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // These files share globals via script tags — too many false positives
      "no-undef": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-redeclare": "warn",
      "no-useless-escape": "warn",
      "no-control-regex": "warn",
      "prefer-const": "warn",
    },
  }
);
