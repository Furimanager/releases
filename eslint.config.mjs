import js from "@eslint/js";
import globals from "globals";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: ["node_modules/**", "dist/**"]
  },
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.serviceworker,
        chrome: "readonly",
        importScripts: "readonly"
      },
      ecmaVersion: 2022,
      sourceType: "module"
    },
    rules: {
      // まずは構文エラーと明らかなバグだけを検出。スタイルは Prettier に任せる。
      "no-unused-vars": "off",
      "no-undef": "error",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-redeclare": "error",
      "no-unreachable": "error",
      "no-useless-escape": "off"
    }
  }
];
