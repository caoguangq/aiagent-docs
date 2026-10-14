// 生产构建一次要几分钟且遇到第一个错误就中断。这个预检脚本把全部文档过一遍
// 「markdown 渲染 → Vue 模板解析」，一次性列出所有会导致构建失败的文档。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMarkdownRenderer } from 'vitepress/dist/node/index.js'
import { parse } from '@vue/compiler-dom'
import {
  escapeStrayHtml,
  reflowCodeBlocks,
  removeDuplicateTitle,
  rewriteMissingImages
} from '../.vitepress/md-normalize.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
// createMarkdownRenderer 不会执行自定义站点的 markdown.config，这里手动挂载同样的插件。
const md = await createMarkdownRenderer({}, root, '/')
md.use(escapeStrayHtml)
md.use(removeDuplicateTitle)
md.use(reflowCodeBlocks)
md.use(rewriteMissingImages, { srcDir: root })

const files = fs
  .readdirSync(root)
  .filter((d) => /^\d{2}_/.test(d) && fs.statSync(path.join(root, d)).isDirectory())
  .flatMap((d) =>
    fs
      .readdirSync(path.join(root, d))
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(d, f))
  )

const bad = []
const dup = []
const zwsp = []
let cramped = 0
const IMG_RE = /<img[^>]*?\ssrc="([^"]+)"/g
const plain = (s = '') => s.replace(/<[^>]+>/g, '').replace(/&[a-zA-Z0-9#]+;/g, '').trim()

for (const rel of files) {
  const html = md.render(fs.readFileSync(path.join(root, rel), 'utf8').replace(/^﻿/, ''), {
    path: rel
  })
  const errors = []

  const h1 = plain(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1])
  const h2 = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => plain(m[1]))
  if (h1 && h2.includes(h1)) dup.push(rel)

  try {
    parse(`<div>${html}</div>`)
  } catch (e) {
    errors.push(`${e.message} @ line ${e.loc?.start?.line}`)
  }

  // Vite 会把无法解析的相对图片当模块 import，构建直接中断
  for (const [, src] of html.matchAll(IMG_RE)) {
    if (/^(?:https?:\/\/|data:|\/\/|mailto:)/.test(src)) continue
    const resolved = src.startsWith('/')
      ? path.join(root, 'public', src.replace(/^\//, ''))
      : path.join(root, path.dirname(rel), src)
    if (!fs.existsSync(resolved)) errors.push(`图片无法解析：${src}`)
  }

  // 重排后仍是「一整行」的超长代码块，以及没清干净的零宽字符
  for (const [, code] of html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)) {
    const rows = code.replace(/<[^>]+>/g, '').split('\n').map((r) => r.trim()).filter(Boolean)
    if (rows.length === 1 && rows[0].length > 200) cramped++
  }
  if (/[\u{FEFF}]/u.test(html)) zwsp.push(rel)

  if (errors.length) bad.push({ rel, errors })
}

for (const { rel, errors } of bad) console.log(`${rel}\n  ${errors.join('\n  ')}`)
if (dup.length) console.log(`\n仍有重复标题：\n  ${dup.join('\n  ')}`)
if (zwsp.length) console.log(`仍含零宽字符：${zwsp.length} 篇`)
console.log(
  `\n${files.length} 篇文档，${bad.length} 篇会导致构建失败，${dup.length} 篇标题重复，${cramped} 个代码块仍是单行`
)
