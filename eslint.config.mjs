import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // API Express legacy y cron en CommonJS (require): fuera del bundle Next, no aplican las reglas TS.
    "src/controllers/**",
    "src/routes/**",
    "src/jobs/**",
    "src/db.js",
    "src/main.js",
    "src/load-env.js",
    "src/lib/supabaseAdmin.js",
    "scripts/**",
    "scripts-diag-tmp*.js",
    "ecosystem.config.cjs",
  ]),
  {
    rules: {
      // Parámetros/variables con guion bajo: se dejan a propósito (firma que debe respetarse).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
