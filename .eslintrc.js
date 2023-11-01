module.exports = {
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": "latest",
    "project": "./modules/tsconfig.settings.json",
    "tsconfigRootDir": __dirname,
    "sourceType": "module"
  },
  "plugins": ["@typescript-eslint"],
  "extends": ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  "rules": {
    "@typescript-eslint/no-unused-vars": "warn",
    "@typescript-eslint/no-floating-promises": ["error"],
    "prefer-const": "warn"
  },
  "env": {
    "browser": false,
    "es2021": true
  }
}
