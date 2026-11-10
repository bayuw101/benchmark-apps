import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // `const { secret: _s, ...rest } = row` is how we strip fields before sending data to the browser.
    rules: { "@typescript-eslint/no-unused-vars": ["warn", { ignoreRestSiblings: true }] },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".next-dev/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
