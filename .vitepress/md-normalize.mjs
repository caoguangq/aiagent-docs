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

// 每篇文档开头的「> 原文链接：https://thoughts.aliyun.com/…」是导出留痕，
// 页面不再展示；源 md 保留不动，只在渲染层删掉整个引用块。
export function removeOriginLink(md) {
  md.core.ruler.push('remove_origin_link', (state) => {
    const tokens = state.tokens
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'blockquote_open') continue
      let depth = 0
      let close = i
      for (; close < tokens.length; close++) {
        if (tokens[close].type === 'blockquote_open') depth++
        else if (tokens[close].type === 'blockquote_close' && !--depth) break
      }
      const inner = tokens.slice(i + 1, close)
      const plain = inner.every((t) =>
        ['paragraph_open', 'paragraph_close', 'inline'].includes(t.type)
      )
      const text = inner
        .filter((t) => t.type === 'inline')
        .map((t) => t.content)
        .join('\n')
        .trim()
      if (plain && /^原文链接[：:]\s*https?:\/\//.test(text)) {
        tokens.splice(i, close - i + 1)
        i--
      }
    }
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

// 语言标签粘在代码尾部时的形态（`…8192Shell`、`…[]}JSON`、`…模糊回答Python`）。
// 用 lookbehind 要求它紧贴非空白字符：正文里以空格分隔的同名单词（--format json）不会被误删。
const GLUED_LABELS = [
  /(?<=\S)(?:Plain[ -]?Text|Java(?:Script)?|TypeScript|Python|Shell|Bash|JSON|YAML|XML|SQL)(?:\s|\uFEFF)*$/
]

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
    // 和最后一行代码粘在一起的标签，例如「…这里输入你的访问令牌Plain Text」「…8192Shell」「…[]}JSON」
    if (last.length) {
      const row = rows[rows.length - 1]
      const glued = GLUED_LABELS.reduce((text, pattern) => text.replace(pattern, ''), row)
      if (glued !== row) {
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
    // 导出工具把换行压平后留下的缩进分隔：Tab 或两个以上空格。
    // 后面紧跟 = 的空格是对齐填充（baseUrl   = http://…），不是丢掉的换行，不能切。
    .replace(/(\S)(\t+| {2,})(?=[^=\s])/g, (all, before, gap) => before + '\n' + gap)
}

// 还有 152 个代码块被压得连分隔空白都没留下（如 `…Definition();aiService.setBeanClass(…)`、
// `…api-key={YOUR_KEY}langchain4j…model-name=…`），只能按语义边界断行。
// 每条规则都要求切点前一个字符是非空白：正常书写的代码在这些边界后本来就跟着空格或换行，
// 所以只会切在「粘连处」。规则只插入换行、不删改任何字符，代码仍可原样复制。
const GLUE_RULES = [
  // 日志行的时间戳
  [/(?<=\S)(?=\d{2}:\d{2}:\d{2}[.,]\d{3}\s)/g, '\n'],
  // Java 语句结尾：分号/右花括号后紧跟新语句
  [/(?<=;)(?=[A-Za-z_@/])/g, '\n'],
  [/(?<=\})(?=[A-Za-z_@])/g, '\n'],
  // 右括号后紧跟修饰符、关键字或另一个方法签名
  [/(?<=\))(?=(?:public|private|protected|static|final|abstract|return|if|for|while|try|catch|throw|new)\b)/g, '\n'],
  [/(?<=\))(?=[A-Z]\w*(?:<[^>]*>)?\s+\w+\s*\()/g, '\n'],
  // 注解与前一行粘在一起（@Autowired@Qualifier(...)）
  [/(?<=[^\s(,=@"'])@(?=[A-Z])/g, '\n@'],
  // 注解名后直接跟修饰符（@Overridepublic int getOrder()）
  [/(@[A-Z]\w*?)(?=(?:public|private|protected|static|final|abstract|class|interface|enum|void|return)\b)/g, '$1\n'],
  // 注解名后直接跟字段类型（@AutowiredOpenAiStreamingChatModel streamingChatModel;）
  [/(@[A-Z][a-z]+)(?=[A-Z]\w*\s+\w+\s*[;=])/g, '$1\n'],
  // XML/HTML 标签之间没有空白，或只剩一个空格
  [/(?<=>)(?=<[A-Za-z!/?])/g, '\n'],
  [/(?<=>)[ \t]+(?=<)/g, '\n'],
  // 相邻的 JSON 对象
  [/(?<=\})(?=\{\s*")/g, '\n'],
  // Python 的 from x import y / import x
  [/(?<=\S)(?=(?:from|import)\s+[\w.]+\s+import\b)/g, '\n'],
  [/(?<=[^\s(])(?=import\s)/g, '\n'],
  // 注释或上一句尾部粘住了赋值语句（…）documents = SimpleDirectoryReader(…)）
  // 切点前必须是非单词字符，否则会落在 DASHSCOPE_API_KEY 这类标识符内部逐字符切
  [/(?<=[^\w\s#(,])(?=[A-Za-z_]\w*\s*=\s)/g, '\n'],
  // 右括号后紧跟下一个函数调用
  [/(?<=\))(?=[a-z_]\w*\()/g, '\n'],
  // RAG 分片示例里的 Chunk 序号
  [/(?<=\S)(?=Chunk\s*\d+[：:])/g, '\n'],
  // 连续 shell 命令粘连（uv init xcd x）
  [/(?<=\S)(?=(?:cd|mkdir|source|uv|python3|python|pip3|pip|npm|npx|git|docker|java|mvn|echo|export|curl)\s)/g, '\n'],
  // SSE 输出的一帧
  [/(?<=\S)(?=data:\{)/g, '\n'],
  // 行内注释（# 前不能是 #，避开 markdown 的 ## 标题）
  [/(?<=[^\s#])(?=#\s)/g, '\n'],
  // 流程图里的箭头
  [/(?<=\S)(?=[↓↑])/g, '\n'],
  // 行内注释与前面的代码粘在一起（.builder()// 1. xxx）；排除 http:// 与 Python 的 // 整除
  [/(?<=[^\s:/"'])(?=\/\/[\s\u4e00-\u9fa5])/g, '\n'],
  // 汉字后面直接跟一句声明（检索器EmbeddingStoreContentRetriever vectorRetriever = …）
  [/(?<=[\u4e00-\u9fa5])(?=[A-Za-z_]\w*(?:<[^>]*>)?\s+\w+\s*[=(])/g, '\n'],
  // 无序列表项（- 前不能是 -，避开 shell 的 --flag 与 SQL 的 -- 注释）
  [/(?<=[^\s-])(?=-\s)/g, '\n'],
  // 有序列表项（前面不能是单词字符，避开 answer2.text()；点号后不能是数字，避开 1.1.0.0）
  [/(?<=[^\w\s.])(?=\d+\.(?!\d))/g, '\n']
]

function splitGluedLine(line) {
  // 整行是被压平的块注释时，按 ` * ` 续行符复原（乘号写法不会出现在注释行首）
  let out = /^\s*\/\*/.test(line) ? line.replace(/(?<=\S) (?=\*(?:\s|\/))/g, '\n ') : line
  for (const [pattern, replacement] of GLUE_RULES) out = out.replace(pattern, replacement)
  // 注释一定延伸到行尾，所以只在含 // 的行里把 `).方法(` 当成丢掉的换行
  // （// 2. QueryTransformer - 查询转换器(可选).queryTransformer(queryTransformer)），
  // 这样不会拆散正常写在一行的流式调用。
  out = out
    .split('\n')
    .map((row) => (row.includes('//') ? row.replace(/(?<=\))(?=\.\w+\()/g, '\n') : row))
    .join('\n')
  // 断点恰好落在行首（或已存在的换行旁）时会多出空行，去掉
  return out.replace(/^[ \t]*\n+/, '').replace(/\n{2,}/g, '\n')
}

// properties 的 key 常和前一个 value 粘在一起（model-name=qwen-max-latestlangchain4j.open-ai…），
// 只看一行没法判断断点在哪。先收集「前面不是单词字符」的 key 作为样本，取出配置的首段前缀
// （spring、langchain4j），再在每个 `前缀.` 处断行——粘连的 value 尾巴就留在上一行了。
const PROPERTY_KEY = /[a-zA-Z][\w-]*(?:\.[\w-]+)+=/g

function splitPropertyKeys(text) {
  const prefixes = new Set()
  for (const match of text.matchAll(PROPERTY_KEY)) {
    // 紧贴 = 之后的是 value（key 已被粘进 value 里），紧贴单词字符的是被截断的 key，都不作样本
    const before = text[match.index - 1]
    const head = match[0].split('.')[0]
    if (head.length >= 3 && (before === undefined || !/[\w=-]/.test(before))) prefixes.add(head)
  }
  if (!prefixes.size) return text
  const heads = [...prefixes].sort((a, b) => b.length - a.length).join('|')
  return text.replace(new RegExp(`(?<=\\S)((?:${heads})\\.)`, 'g'), '\n$1')
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
      // 整块被压成一行时换行已彻底丢失，按缩进分隔 + 语义边界复原（yaml/纯文本同样适用）；
      // 本身有正常换行的块只处理异常超长行且保留代码特征判断，避免误伤排版好的代码。
      const flattened = token.content.split('\n').filter((line) => line.trim()).length <= 1
      const restored = stripTrailingLabel(token.content.split('\uFEFF').join('\n'))
      const text = flattened ? splitPropertyKeys(restored) : restored
      const rows = text.split('\n').flatMap((line) => {
        if (flattened) {
          if (/[\u2502\u251C\u2514]/.test(line)) return splitTreeLine(line).split('\n')
          return splitGluedLine(splitFlattenedLine(line)).split('\n')
        }
        if (line.length < 200) return [line]
        if (/[\u2502\u251C\u2514]/.test(line)) return splitTreeLine(line).split('\n')
        return isSplittableCode(line) ? splitFlattenedLine(line).split('\n') : [line]
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

// 表格单元格里被压平的换行同样是 U+FEFF（`- 快速搭建聊天机器人﻿- 调用外部工具…`），
// 但单元格不能放真换行，这里换成 <br>。代码块里的 U+FEFF 是 reflowCodeBlocks 复原分行的
// 唯一依据，必须先跳过围栏区域，否则代码会被替换成 <br> 而彻底散架。
function breakGluedTableCells(src) {
  let inFence = false
  return src
    .split('\n')
    .map((line) => {
      if (/^\s*(?:```|~~~)/.test(line)) inFence = !inFence
      if (inFence || !line.includes('|') || !line.includes('\uFEFF')) return line
      return line
        .replace(/\uFEFF[ \t]*/g, '<br>')
        .replace(/\|[ \t]*<br>/g, '|')
        .replace(/<br>[ \t]*\|/g, '|')
    })
    .join('\n')
}

export function fixEmptyTableHeaders(md) {
  // 表格在 block 解析阶段就会因空表头被拒，只能在 parse 前改源文本
  const original = md.parse
  md.parse = function (src, env) {
    return original.call(this, promoteTableHeaders(breakGluedTableCells(src)), env)
  }
}

// 导出工具留下的占位图片（![](xxx.png)、![图片](URL)）会被 Vite 当资源解析并让构建中断。
// 正文里还有一类「示例语法」：作者本意是展示 markdown 写法或模型虚构的内容
// （把![](images/xxx.jpg)替换成…、模型虚构了【![图片](https://example.com/…)】），
// 这些不该去加载也不该显示占位盒子，还原成行内代码最贴合原意。
const EXAMPLE_SRC = /(?:^|[/_\-.])x{3}(?:[/_\-.]|$)|^https?:(?!\/\/)|^(?:https?:\/\/)?(?:www\.)?example\.(?:com|org|net|co)\b/i

export function rewriteMissingImages(md, { srcDir, placeholder = '/missing-image.svg' }) {
  md.core.ruler.push('fix_missing_images', (state) => {
    const file = state.env?.relativePath || state.env?.path
    if (!file) return
    const docDir = path.dirname(String(file).replace(/^\//, ''))

    const visit = (tokens) => {
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]
        if (token.type === 'image') {
          const src = token.attrGet('src') ?? ''
          if (EXAMPLE_SRC.test(src)) {
            const code = new state.Token('code_inline', 'code', 0)
            code.content = `![${token.content}](${src})`
            tokens[i] = code
            continue
          }
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

    // 占位图是一块大盒子，和文字同处一段时（`![描述](地址) 这段内容…`）文字会紧贴盒子下沿，
    // 而 CSS 选不到「元素后面跟着文本节点」，只能在 token 层把段落拆开。
    const isPlaceholder = (token) =>
      token.type === 'image' && (token.attrGet('src') ?? '').endsWith(placeholder)

    const out = []
    for (let i = 0; i < state.tokens.length; i++) {
      const inline = state.tokens[i + 1]
      if (state.tokens[i].type !== 'paragraph_open' || inline?.type !== 'inline') {
        out.push(state.tokens[i])
        continue
      }
      const idx = inline.children.findIndex(isPlaceholder)
      const before = idx >= 0 ? inline.children.slice(0, idx) : inline.children
      const after = idx >= 0 ? inline.children.slice(idx + 1) : []
      // 只能裁掉空白文本与软换行：link_open 这类结构 token 的 content 也是空串，裁掉会留下没闭合的标签
      const isBlank = (token) =>
        token.type === 'softbreak' || (token.type === 'text' && !(token.content ?? '').trim())
      while (before.length && isBlank(before[before.length - 1])) before.pop()
      while (after.length && isBlank(after[0])) after.shift()
      if (before.length && before[before.length - 1].type === 'text') {
        before[before.length - 1].content = before[before.length - 1].content.trimEnd()
      }
      if (after.length && after[0].type === 'text') after[0].content = after[0].content.trimStart()
      // 图片若嵌在链接/强调内部（[![](x)](y)），拆段会把标签对切断，这种情况保持原样
      let depth = 0
      for (const child of inline.children.slice(0, idx)) depth += child.nesting
      if (idx < 0 || depth !== 0 || (!before.length && !after.length)) {
        out.push(state.tokens[i])
        continue
      }
      const para = (children) => {
        const open = new state.Token('paragraph_open', 'p', 1)
        const body = new state.Token('inline', '', 0)
        body.children = children
        body.content = children.map((child) => child.content ?? '').join('')
        return [open, body, new state.Token('paragraph_close', 'p', -1)]
      }
      if (before.length) out.push(...para(before))
      out.push(...para([inline.children[idx]]))
      if (after.length) out.push(...para(after))
      i += 2
    }
    state.tokens = out
  })
}
