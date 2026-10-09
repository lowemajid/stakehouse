import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // Floats-for-money is forbidden: the ledger orchestrates but never does its
  // own arithmetic. Every money operation goes through the integer-cent
  // helpers in money.ts, which validate integer-ness and safe ranges.
  {
    files: ['packages/domain/src/ledger.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "BinaryExpression[operator='+'],BinaryExpression[operator='-'],BinaryExpression[operator='*'],BinaryExpression[operator='/'],BinaryExpression[operator='%']",
          message:
            'Money arithmetic must go through the integer-cent helpers in money.ts — raw operators can drift cents.',
        },
      ],
    },
  },
  prettier,
);
