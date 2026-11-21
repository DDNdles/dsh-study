import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'dist')
await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(path.join(output, 'host'), { recursive: true })

await build({
  entryPoints: [path.join(root, 'src/host/index.js')],
  outfile: path.join(output, 'host/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  packages: 'external',
  external: ['@deepseek-ai/*'],
  sourcemap: true,
})

const client = await build({
  entryPoints: [path.join(root, 'src/client.js')],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['react'],
  jsx: 'automatic',
})
const clientCode = client.outputFiles[0].text
await fs.writeFile(path.join(output, 'client.js'),
  `window.__ModuleLoader__.load({id:"dsh-study",factory:(require)=>{const module={exports:{}};const exports=module.exports;${clientCode}\nreturn module.exports;}});\n`)

await Promise.all(['schemas', 'templates', 'locale', 'skills'].map(directory =>
  fs.cp(path.join(root, directory), path.join(output, directory), { recursive: true })))
await fs.cp(path.join(root, 'node_modules/katex/dist'), path.join(output, 'katex'), { recursive: true })
await Promise.all(['icon.svg', 'README.md'].map(file =>
  fs.copyFile(path.join(root, file), path.join(output, file))))
