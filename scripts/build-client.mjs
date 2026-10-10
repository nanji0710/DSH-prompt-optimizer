// 客户端打包脚本：将 src/client/index.tsx 打包为单文件 dist/client/index.js
// DSH 宿主通过 window.__ModuleLoader__.load() 注册客户端插件（非 ESM、非 CJS）
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
  ],
  // 用 DSH 的 __ModuleLoader__ 包装：factory 只接收 require，内部自建 module 对象
  banner: {
    js: 'window.__ModuleLoader__.load({id:"prompt-optimizer", factory:(require)=>{var module={exports:{}};'
  },
  footer: {
    js: 'return module.exports}})'
  }
})

console.log('[build] client bundle -> dist/client/index.js')
