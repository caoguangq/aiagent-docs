import fs from 'node:fs'
import path from 'node:path'

// 源文档正文里大量出现 Flux<String>、List<POJO>、<dependency> 这类尖括号片段。
// markdown-it 会把它们当作原始 HTML 透传，Vue 模板编译器随即报「Element is missing end tag」。
// 这里只放行真正的 HTML 标签、自闭合的 Vue 组件与注释，其余转义成文本，避免改写 299 篇源文档。
const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'audio', 'b', 'big', 'blockquote', 'br', 'button', 'cite', 'code',
  'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em',
  'figcaption', 'figure', 'font', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'i', 'iframe', 'img', 'input', 'ins', 'kbd', 'label', 'legend', 'li',
  'mark', 'ol', 'option', 'p', 'pre', 'q', 'rb', 'rp', 'rt', 'ruby', 's',
  'samp', 'section', 'select', 'small', 'source', 'span', 'strong', 'sub',
  'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr',
  'u', 'ul', 'var', 'video', 'wbr'
])

const SVG_TAGS = new Set([
  'svg', 'path', 'rect', 'circle', 'line', 'polyline', 'polygon', 'g', 'defs',
  'marker', 'text', 'tspan'
])

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr'
])

const TAG_RE = /^\s*<\/?\s*([a-zA-Z][a-zA-Z0-9]*)/

function isPassThrough(content, inline) {
  const trimmed = content.trim()
  // markdown-it-anchor 生成的标题锚点符号是 &ZeroWidthSpace;，不含标签，不能转义
  if (!trimmed.startsWith('<')) return true
  if (trimmed.startsWith('<!--') || trimmed.startsWith('<!DOCTYPE')) return true
  const match = trimmed.match(TAG_RE)
  if (!match) return false
  const raw = match[1]
  const tag = raw.toLowerCase()
  // Java 泛型（List<Message>、Flux<String>）首字母也大写，只有自闭合写法才当作 Vue 组件
  if (/^[A-Z]/.test(raw)) return /^<[^>]*\/>$/.test(trimmed)
  if (tag.includes('-')) return true
  // 行内 HTML 常是正文里提到的标签名（如「输出 <table> 片段」），只放行自闭合与空元素
  if (inline) return VOID_TAGS.has(tag) || /^<[^>]*\/>$/.test(trimmed)
  return ALLOWED_TAGS.has(tag) || SVG_TAGS.has(tag)
}

export function escapeStrayHtml(md) {
  // 改写 renderer.rules 会被 VitePress 自己的默认实现覆盖，这里在 core 阶段直接处理 token。
  md.core.ruler.push('escape_stray_html', (state) => {
    const visit = (tokens) => {
      for (const token of tokens) {
        if (token.type === 'html_block' || token.type === 'html_inline') {
          if (!isPassThrough(token.content, token.type === 'html_inline')) {
            token.content = md.utils.escapeHtml(token.content)
          }
        }
        if (token.children) visit(token.children)
      }
    }
    visit(state.tokens)
  })
}

// 导出工具会在正文里同时写下 `# 标题` 和紧随其后的 `## 标题`，页面因此重复渲染同一个标题。
// 这里删掉与首个 H1 同名的第一个 H2，保留源文档不动。
export function removeDuplicateTitle(md) {
  md.core.ruler.push('remove_duplicate_title', (state) => {
    const headingText = (index) =>
      state.tokens[index + 1]?.type === 'inline' ? state.tokens[index + 1].content.trim() : ''

    let first = -1
    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i]
      if (token.type !== 'heading_open') continue
      const text = headingText(i)
      if (!text) continue
      if (token.tag === 'h1' && first < 0) first = i
      else if (token.tag === 'h2' && first >= 0 && text === headingText(first)) {
        state.tokens.splice(i, 3)
        return
      }
    }
  })
}

// 导出工具把代码块里的换行写成了零宽字符 U+FEFF，压平的代码只留下缩进空格，
// 连页面角落的语言标签（Plain Text）也被一起复制进来。这里只在渲染层复原分行，不改源文件。
const CODE_LABELS = new Set([
  'plain text', 'plaintext', 'text', 'bash', 'shell', 'sh', 'console', 'json', 'yaml',
  'xml', 'html', 'css', 'java', 'kotlin', 'groovy', 'python', 'javascript', 'typescript',
  'sql', 'markdown', 'dockerfile', 'properties', 'ini', 'toml', 'go', 'rust', 'diff', 'log'
])

function stripTrailingLabel(text) {
  const rows = text.split('\n')
  let changed = true
  while (changed) {
    changed = false
    while (rows.length && !rows[rows.length - 1].trim()) {
      rows.pop()
      changed = true
    }
    const last = rows.length ? rows[rows.length - 1].trim() : ''
    if (rows.length > 1 && CODE_LABELS.has(last.toLowerCase())) {
      rows.pop()
      changed = true
      continue
    }
    // 和正文粘在一起的标签，例如「…这里输入你的访问令牌Plain Text」
    if (last.length > 10) {
      const glued = last.replace(/(?:\s|\uFEFF)*(?:Plain[ -]?Text)+(?:\s|\uFEFF)*$/i, '')
      if (glued !== last) {
        rows[rows.length - 1] = glued
        changed = true
      }
    }
  }
  return rows.join('\n')
}

function isSplittableCode(line) {
  if (!/[{};=<>@]|\b(?:import|public|private|class|interface|def|return|function|curl|builder)\b/.test(line)) {
    return false
  }
  const indents = (line.match(/ {2,}/g) || []).length
  const continuations = (line.match(/\\(?=-)/g) || []).length
  return indents >= 2 || continuations >= 1
}

function splitFlattenedLine(line) {
  return line
    .replace(/(\\)(?=-)/g, '$1\n')
    .replace(/(\S)( {2,})(?=\S)/g, (all, before, gap) => before + '\n' + gap)
}

// 目录树/框图压成一行后，行首的 ─│├└ 连接符就是原来的换行位置：
// 只要连接符前面不是空白也不是另一个连接符，就是新起的一行。
const TREE_LINE_START = /([^\s\u2500-\u25AF])(?: {2,})?(?=[\u2502\u251C\u2514])/g

function splitTreeLine(line) {
  return line.replace(TREE_LINE_START, '$1\n')
}

export function reflowCodeBlocks(md) {
  md.core.ruler.push('reflow_code_blocks', (state) => {
    for (const token of state.tokens) {
      if (token.type !== 'fence') continue
      // 整块被压成一行时按缩进复原；本身有正常换行的块只处理异常超长行，避免误伤排版好的代码。
      const flattened = token.content.split('\n').filter((line) => line.trim()).length <= 1
      const minLen = flattened ? 60 : 200
      const text = stripTrailingLabel(token.content.split('\uFEFF').join('\n'))
      const rows = text.split('\n').map((line) => {
        if (line.length < minLen) return line
        if (/[\u2502\u251C\u2514]/.test(line)) return splitTreeLine(line)
        return isSplittableCode(line) ? splitFlattenedLine(line) : line
      })
      token.content = rows.length ? rows.join('\n') : '\n'
    }
  })
}

// 导出工具把表格头行写成只含竖号的空行（` |  | `），而 markdown-it 的表格规则
// 拒绝表头全空的表格，132 张表因此全部退化成段落文本。真正的表头被挤在表体第一行
// （如「对比项 | Spring AI | LangChain4J」）。解析前把表体首行提为表头、删掉空表头行。
const TABLE_SEP = /^\s*\|?[\t ]*:?-{2,}:?[\t ]*(?:\|[\t ]*:?-{2,}:?[\t ]*)*\|?\s*$/

function isEmptyHeaderRow(line) {
  return line.includes('|') && line.split('|').every((cell) => !cell.trim())
}

function splitCells(line) {
  const chunks = line.split(/(?<!\\)\|/)
  if (chunks.length > 1 && line.trimEnd().endsWith('|')) chunks.pop()
  return chunks
}

// markdown-it 对表头行的竖线写法与列数极其挑剔（前导空格+首格空、列数少于分隔行等
// 都会整表退化成段落）。提升后的表头统一规范化成 `| a | b |` 标准形并对齐分隔行列数。
function canonicalHeader(line, columnCount) {
  let cells = splitCells(line)
  if (cells.length === columnCount + 1 && !cells[0].trim()) cells.shift()
  if (cells.length === columnCount - 1) cells.unshift('')
  while (cells.length < columnCount) cells.push('')
  if (cells.length > columnCount) cells = cells.slice(0, columnCount)
  return `| ${cells.map((cell) => cell.trim()).join(' | ')} |`
}

function promoteTableHeaders(src) {
  const lines = src.split(/\r?\n/)
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const sep = lines[i]
    const header = out[out.length - 1]
    const firstBody = lines[i + 1]
    if (
      TABLE_SEP.test(sep) &&
      sep.includes('|') &&
      header !== undefined &&
      isEmptyHeaderRow(header) &&
      firstBody !== undefined &&
      firstBody.includes('|') &&
      firstBody.trim()
    ) {
      const sepCells = splitCells(sep).map((cell) => cell.trim()).filter(Boolean)
      out[out.length - 1] = canonicalHeader(firstBody, sepCells.length)
      out.push(`| ${sepCells.join(' | ')} |`)
      i++
      continue
    }
    out.push(sep)
  }
  return out.join('\n')
}

export function fixEmptyTableHeaders(md) {
  // 表格在 block 解析阶段就会因空表头被拒，只能在 parse 前改源文本
  const original = md.parse
  md.parse = function (src, env) {
    return original.call(this, promoteTableHeaders(src), env)
  }
}

// 导出工具留下的占位图片（![](xxx.png)、![图片](URL)）会被 Vite 当资源解析并让构建中断。
export function rewriteMissingImages(md, { srcDir, placeholder = '/missing-image.svg' }) {
  md.core.ruler.push('fix_missing_images', (state) => {
    const file = state.env?.relativePath || state.env?.path
    if (!file) return
    const docDir = path.dirname(String(file).replace(/^\//, ''))

    const visit = (tokens) => {
      for (const token of tokens) {
        if (token.type === 'image') {
          const src = token.attrGet('src') ?? ''
          const external = /^(?:https?:\/\/|data:|\/\/|mailto:)/.test(src)
          if (!external && !fs.existsSync(path.join(srcDir, docDir, src))) {
            token.attrSet('src', placeholder)
            token.attrSet('alt', `图片缺失：${src}`)
          }
        }
        if (token.children) visit(token.children)
      }
    }
    visit(state.tokens)
  })
}
