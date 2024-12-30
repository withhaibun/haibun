import { configDefaults, defineProject } from 'vitest/config'

export default defineProject({
  test: {
    exclude: [...configDefaults.exclude, '**/**\\.js', '**/build/**']
  }
});
