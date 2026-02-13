import tseslint from "typescript-eslint";
import js from "@eslint/js";
import globals from "globals";

export default tseslint.config(
    {
        // Global Ignores
        ignores: ["dist", "node_modules", "runs", "logs", "assets"],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parserOptions: { project: "./tsconfig.json" },
            globals: { ...globals.node },
        },
        rules: {
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/no-unused-vars": "off",
            "no-undef": "off",

            // IRON RULES
            "no-restricted-syntax": [
                "error",
                {
                    "selector": "TryStatement",
                    "message": "IRON RULE #5: try-catch is forbidden. Fail Fast."
                }
            ],
            "max-lines": ["error", { "max": 200, "skipComments": true, "skipBlankLines": true }],
            "max-lines-per-function": ["error", { "max": 100, "skipComments": true, "skipBlankLines": true }],
            "complexity": ["error", 20]
        },
    },
    {
        // Agent Specific: Must extend BaseAgent
        files: ["src/agents/*.ts"],
        rules: {
            "no-restricted-syntax": [
                "error",
                { "selector": "TryStatement", "message": "IRON RULE #5: No try-catch." },
                { "selector": "ClassDeclaration[superClass=null]", "message": "IRON RULE #6: Must extend BaseAgent." }
            ]
        }
    }
);
