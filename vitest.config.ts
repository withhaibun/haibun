import { configDefaults, defineProject } from 'vitest/config'

export default defineProject({
  test: {
    include: ['**/*.{test}.ts'],
    exclude: [...configDefaults.exclude, '**/build/**']
  }
});
