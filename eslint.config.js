/** typescript-eslint's type-aware check that refuses a template literal's expression that isn't text, a number, a boolean or absent,
 *  such as a function, whose source the literal would hold. Biome reads everything else. */
import tseslint from "typescript-eslint";

export default tseslint.config(
	{ ignores: ["**/node_modules/**", "**/build/**", "**/capture/**", "**/*.d.ts", "**/*.js", "**/*.mjs", "**/*.cjs"] },
	{
		files: ["**/*.ts"],
		languageOptions: { parser: tseslint.parser, parserOptions: { projectService: true } },
		plugins: { "@typescript-eslint": tseslint.plugin },
		linterOptions: { reportUnusedDisableDirectives: "off" },
		rules: {
			"@typescript-eslint/restrict-template-expressions": [
				"error",
				{ allowNumber: true, allowBoolean: true, allowNullish: true, allowAny: false, allowRegExp: false, allowNever: false, allowArray: false },
			],
		},
	},
);
