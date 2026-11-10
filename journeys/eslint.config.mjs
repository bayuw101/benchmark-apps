import tsParser from "@typescript-eslint/parser";

/*
 * PRD E7.2: journeys must never log credentials or card data. Runner logs go to CloudWatch and the run's
 * artifacts, where every reader of the run can see them. Rejects a console.* call when anything inside it (a
 * variable, a property, a string or template text) names a token, password, secret, card, cookie or auth header.
 * A false positive is cheaper than a leaked secret: rename the variable or log something else.
 */
const SENSITIVE = "/token|passw|secret|card|cvv|cvc|authorization|bearer|cookie|session|api.?key/i";
const message = "Don't log credentials or card data from a journey (PRD E7.2). Log an ID or a status instead.";

export default [
  { ignores: ["dist/**", "node_modules/**"] },
  {
    files: ["src/**/*.ts"],
    languageOptions: { parser: tsParser, ecmaVersion: "latest", sourceType: "module" },
    rules: {
      "no-restricted-syntax": [
        "error",
        ...["Identifier[name", "Literal[value", "TemplateElement[value.raw"].map((node) => ({
          selector: `CallExpression[callee.object.name='console'] ${node}=${SENSITIVE}]`,
          message,
        })),
      ],
    },
  },
];
