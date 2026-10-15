// @ts-check
// ESLint for the Angular app (FE-06). The selector prefix is the project's "mentor"; the recommended Angular and
// TypeScript rule sets apply. Rules that contradict deliberate choices of this codebase are switched off or demoted
// to warnings here, each with its reason, so that `ng lint` is a clean gate and new findings stand out.
const eslint = require("@eslint/js");
const { defineConfig } = require("eslint/config");
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");

module.exports = defineConfig([
  {
    files: ["**/*.ts"],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      "@angular-eslint/directive-selector": ["error", { type: "attribute", prefix: "mentor", style: "camelCase" }],
      "@angular-eslint/component-selector": ["error", { type: "element", prefix: "mentor", style: "kebab-case" }],
      // Signals and `inject()` are used throughout; the class-based lifecycle rules do not apply.
      "@angular-eslint/prefer-inject": "off",
      // Outputs named after DOM events (change, cancel) are part of the existing component contracts.
      "@angular-eslint/no-output-native": "warn",
      // Index signatures `{ [key: string]: T }` and `Record<string, T>` are both in use; neither is wrong.
      "@typescript-eslint/consistent-indexed-object-style": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      // HTTP error payloads are untyped at the boundary; elsewhere `any` should stay visible as a warning.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-function": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true }],
      // Filename and upload validation deliberately rejects control characters with explicit \u0000-\u001f ranges.
      "no-control-regex": "off",
      "no-useless-escape": "warn",
    },
  },
  {
    files: ["**/*.spec.ts", "e2e/**/*.ts", "integration/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-function": "off",
    },
  },
  {
    files: ["**/*.html"],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      // Rows and cards that react to clicks are being made keyboard-reachable under UX-16/UX-17; until then a warning.
      "@angular-eslint/template/click-events-have-key-events": "warn",
      "@angular-eslint/template/interactive-supports-focus": "warn",
    },
  },
]);
