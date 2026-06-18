import { defineConfig } from 'vite-plus';

// oxlint-disable-next-line import/no-default-export
export default defineConfig({
  lint: {
    plugins: [
      'eslint',
      'import',
      'jest',
      'oxc',
      'react',
      'typescript',
      'unicorn',
      'vitest',
    ],
    categories: {
      correctness: 'error',
      suspicious: 'warn',
    },
    options: {
      reportUnusedDisableDirectives: 'error',
      typeAware: true,
      typeCheck: true,
    },
    env: {
      'shared-node-browser': true,
      es2022: true,
    },
    ignorePatterns: ['build', 'gen'],
    rules: {
      'import/no-default-export': 'error',
      'no-console': 'error',
      'typescript/no-explicit-any': 'error',
      'typescript/no-invalid-void-type': [
        'error',
        { allowAsThisParameter: true },
      ],
      'typescript/no-misused-promises': 'error',
      'typescript/no-non-null-assertion': 'error',
      'typescript/no-unsafe-return': 'error',
    },
    overrides: [
      {
        files: ['scripts/**'],
        rules: {
          'no-console': 'off',
        },
      },
      {
        // Test files lean on loosely-typed mocks: untyped `vi.fn()`, `as unknown
        // as Client` casts, and `any` query params. Relax those mock-only rules.
        files: ['**/__tests__/**', '**/*.spec.ts'],
        rules: {
          'vitest/require-mock-type-parameters': 'off',
          'typescript/no-explicit-any': 'off',
          'typescript/no-unsafe-type-assertion': 'off',
        },
      },
    ],
  },
  fmt: {
    singleQuote: true,
    printWidth: 80,
    sortImports: {
      groups: [
        'builtin',
        'external',
        ['internal', 'subpath'],
        'parent',
        ['sibling', 'index'],
        'style',
        'unknown',
      ],
    },
    sortPackageJson: true,
    ignorePatterns: ['CHANGELOG.md'],
  },
  test: {
    clearMocks: true,
    environment: 'jsdom',
    expect: {
      requireAssertions: true,
    },
    // Adding `server.deps.inline: ['vitest-mock-extended']` tells Vitest to
    // process this package through Vite's transform pipeline instead of
    // loading it as an external. This allows Vitest to properly intercept the
    // `import { vi } from 'vitest'` inside `vitest-mock-extended` and provide
    // the correct context-aware `vi` instance.
    server: {
      deps: {
        inline: ['vitest-mock-extended'],
      },
    },
    setupFiles: 'test/setup-tests.ts',
  },
});
