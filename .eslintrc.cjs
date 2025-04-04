module.exports = {
  // Base configuration applies to all files
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": "latest",
    "sourceType": "module"
  },
  "plugins": ["@typescript-eslint"],
  "extends": ["eslint:recommended"],
  "env": {
    "node": true, // Add node env for config files like this one
    "es2021": true
  },
  "ignorePatterns": ["**/build/**", "node_modules/**", ".eslintrc.cjs"], // Ignore build artifacts, node_modules, and this file itself
  "rules": {
    "prefer-const": "warn" // Keep general rules here
  },
  "overrides": [
    {
      // Type-aware linting for TypeScript files within modules
      "files": ["modules/**/*.ts"],
      "extends": ["plugin:@typescript-eslint/recommended"],
      "parserOptions": {
        "project": ["./modules/tsconfig.eslint.json"], // Specify project for type-aware rules (includes tests)
        "tsconfigRootDir": __dirname
      },
      "rules": {
        // TypeScript-specific rules requiring type information
        "@typescript-eslint/no-unused-vars": "warn",
        "@typescript-eslint/no-floating-promises": ["error"],
        "@typescript-eslint/no-misused-promises": ["error"],
        "@typescript-eslint/require-await": "warn"
        // Add other type-aware rules here if needed
      }
    },
    {
      // Configuration for root-level JS/TS/CJS files (like vitest configs, eslint config)
      // These don't need the strict module tsconfig settings
      "files": ["*.js", "*.ts", "*.cjs"],
      "excludedFiles": ["modules/**/*"], // Exclude files already covered by the above override
      "rules": {
        // Relax or adjust rules for config files if necessary
        // For example, root config files might use require()
        "@typescript-eslint/no-var-requires": "off" // Allow require in CJS config file
      }
    }
  ]
}
