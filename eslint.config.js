import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    // 构建产物与脚手架产物都不参与 lint：
    // dist / dist-pages 是 Vite 产物，.backup 是改动前的原文件与对照站点，
    // .mobile-audit 是验收截图与探针脚本
    ignores: [
      'dist/**',
      'dist-pages/**',
      'node_modules/**',
      'public/**',
      '*.min.js',
      '.backup/**',
      '.mobile-audit/**',
    ],
  },
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
  {
    rules: {
      // 单文件组件 / 视图文件名遵循 `XxxView.vue` 约定，无需强制多词。
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  prettier,
)
