const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

const serverConfig = js.configs.recommended;

module.exports = [
  {
    ignores: ['frontend/**', 'dist/**', 'node_modules/**'],
  },
  {
    ...serverConfig,
    files: ['**/*.js'],
    languageOptions: {
      ...serverConfig.languageOptions,
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...serverConfig.rules,
      'no-console': 'off',
    },
  },
  prettier,
];
