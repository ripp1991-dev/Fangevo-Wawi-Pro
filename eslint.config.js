// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      'apps/web/src/routeTree.gen.ts',
      'packages/database/prisma/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  // Modulgrenzen: Das Frontend darf nie direkt auf Datenbank oder API-Interna zugreifen.
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@fangevo/database', '@fangevo/database/*', '@prisma/*'],
              message: 'Frontend darf nicht auf die Datenbank zugreifen.',
            },
            { group: ['**/apps/api/**'], message: 'Frontend darf keine API-Interna importieren.' },
          ],
        },
      ],
    },
  },
  // Gemeinsame Pakete dürfen nichts aus apps/ importieren.
  {
    files: ['packages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: ['**/apps/**'], message: 'Pakete dürfen nicht von Apps abhängen.' }],
        },
      ],
    },
  },
  // Nur das Datenbank-Paket spricht direkt mit Prisma.
  {
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/core/database/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@prisma/client', '@prisma/client/*'],
              message: 'Datenbankzugriff nur über @fangevo/database bzw. core/database.',
            },
          ],
        },
      ],
    },
  },
  // Tests dürfen lockerer typisieren (API-Antworten).
  {
    files: ['**/test/**/*.ts', '**/*.test.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
