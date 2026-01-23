import tseslint from "typescript-eslint";
import js from "@eslint/js";
import globals from "globals";

export default tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parserOptions: {
                project: "./tsconfig.json",
            },
            globals: {
                ...globals.node,
            },
        },
        rules: {
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/no-unused-vars": "off",
            "no-undef": "off", // TypeScript already handles this
        },
    }
);
