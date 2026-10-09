// 客户端打包脚本：将 src/client/index.tsx 打包为单文件 dist/client/index.js
// DSH 宿主运行时提供的包全部标记为 external，不打进产物
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

mkdirSync('dist/client', { recursive: true })

await build({
  entryPoints: ['src/client/index.tsx'],
  bundle: true,
  outfile: 'dist/client/index.js',
  platform: 'browser',
  format: 'cjs',
  target: ['chrome110'],
  jsx: 'automatic',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    'cordis',
    '@deepseek-ai/*'
  ]
})

console.log('[build] client bundle -> dist/client/index.js')
