// ESLint Flat Config for Seed
// https://typescript-eslint.io/getting-started/

import tseslint from 'typescript-eslint';

export default tseslint.config(
  // TypeScript files
  tseslint.configs.recommended,

  // Ignore patterns
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.seed/**',
      'coverage/**',
    ],
  },

  // Custom rules
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
