import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, '.vitepress')

const CHAPTER_RE = /^(\d{2})_(.+)$/
const STATUS_RE = /（更新中）$/

const TOPIC_TAGS = [
  ['提示词', '提示词工程'],
  ['Spring AI', 'Spring AI'],
  ['LangChain4', 'LangChain4j'],
  ['Function Call', 'Function Call'],
  ['MCP', 'MCP'],
  ['RAG', 'RAG'],
  ['Agent', 'Agent'],
  ['Workflow', 'Workflow'],
  ['上下文', '上下文工程'],
  ['记忆', '长期记忆'],
  ['Harness', 'Harness'],
  ['Skill', 'Skills'],
  ['AgentScope', 'AgentScope'],
  ['微调', '大模型微调'],
  ['评测', 'RAG 评测'],
  ['dodo-agent', '项目实战'],
  ['know-engine', '项目实战']
]

// Files live in numbered chapter dirs; anything else is site scaffolding.
function chapterDirs() {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && CHAPTER_RE.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }))
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function readDocTitle(abs) {
  const fd = fs.openSync(abs, 'r')
  const buf = Buffer.alloc(8192)
  const bytes = fs.readSync(fd, buf, 0, 8192, 0)
  fs.closeSync(fd)
  const head = stripBom(buf.toString('utf8', 0, bytes))
  const match = head.match(/^#\s+(.+?)\s*$/m)

  return (match ? match[1] : path.basename(abs, '.md')).trim()
}

function tagsFor(chapterTitle) {
  const tags = []
  if (/面试/.test(chapterTitle)) tags.push('面试')
  if (/项目实战|实战/.test(chapterTitle)) tags.push('项目实战')
  if (/加餐/.test(chapterTitle)) tags.push('加餐')
  for (const [needle, tag] of TOPIC_TAGS) {
    if (chapterTitle.includes(needle) && !tags.includes(tag)) tags.push(tag)
  }
  if (/学前必看|更新记录|代码介绍/.test(chapterTitle)) tags.push('开始之前')
  if (/概述|原理|工程|评测/.test(chapterTitle) && !tags.includes('面试')) tags.push('理论')
  if (STATUS_RE.test(chapterTitle)) tags.push('更新中')
  return tags
}

// 导出文档按文件名拼音排序会丢上课顺序；同级目录里的视频文件编号才是真实课序。
const videoRoot = path.join(root, '..')

function normTitle(s) {
  return s
    .replace(/^\d+\.\s*/, '')
    .replace(/\s*\.sz\s*$/, '')
    .replace(/\s*\d{4}-\d{2}-\d{2}.*$/, '')
    .replace(/\s*\d+\s*次学习.*$/, '')
    .replace(/[（(][上中下][）)]\s*$/, '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/^✅/, '')
    .replace(/^【[^】]*】/, '')
    .replace(/[？?！!]+$/, '')
}

function dice(a, b) {
  const bg = (s) => {
    const m = new Map()
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) || 0) + 1)
    return m
  }
  const [x, y] = [bg(a), bg(b)]
  let hit = 0
  for (const [g, n] of x) hit += Math.min(n, y.get(g) || 0)
  return (2 * hit) / (a.length - 1 + (b.length - 1))
}

function collectVideos() {
  const out = []
  if (!fs.existsSync(videoRoot)) return out
  for (const entry of fs.readdirSync(videoRoot, { withFileTypes: true })) {
    const m = entry.name.match(/^(\d{1,2})\./)
    if (!m) continue
    const isDir = entry.isDirectory()
    if (!isDir && !entry.name.endsWith('.sz')) continue
    const id = (isDir ? 'd' : 'f') + Number(m[1])
    if (isDir) {
      for (const f of fs.readdirSync(path.join(videoRoot, entry.name))) {
        const fm = f.match(/^(\d+)\./)
        if (f.endsWith('.sz') && fm) out.push({ id, num: Number(fm[1]), key: normTitle(f) })
      }
    } else {
      out.push({ id, num: Number(m[1]), key: normTitle(entry.name) })
    }
  }
  return out
}

const VIDEOS = collectVideos()

const ORDER_FILE = path.join(outDir, 'lesson-order.json')
// 没有视频目录的机器（如 CI）用仓库里提交的课序快照排序
let snapshotLessons = {}
if (!VIDEOS.length && fs.existsSync(ORDER_FILE)) {
  snapshotLessons = JSON.parse(fs.readFileSync(ORDER_FILE, 'utf8')).lessons || {}
}

// 章节 → 视频来源（f=顶层单视频，d=文件夹），编号为视频侧的文件夹前缀
const CHAPTER_SOURCES = {
  '02_学前必看': ['f1', 'f2'],
  '03_代码介绍&应用启动': ['d1'],
  '04_大模型开发概述': ['d2'],
  '05_提示词工程': ['d3'],
  '06_初探Spring AI': ['d4'],
  '07_LangChain4j': ['d5'],
  '08_Function Call': ['d6'],
  '09_MCP': ['d7'],
  '10_RAG': ['d8'],
  '12_Workflow': ['d9'],
  '11_Agent': ['d10'],
  '13_上下文工程': ['d11'],
  '14_长期记忆': ['d12'],
  '16_Skills': ['d13'],
  '17_AgentScope（更新中）': ['d14'],
  '15_Harness（更新中）': ['d15'],
  '19_项目实战1（dodo-agent）': ['d16'],
  '20_项目实战2（know-engine）（更新中）': ['d17'],
  '21_RAG评测（更新中）': ['d18'],
  '24_面试专用（通用）': ['d19'],
  '25_面试专用（dodo-agent）': ['d19'],
  '26_面试专用（know-engine）': ['d19'],
  '18_大模型微调': ['d20'],
  '22_项目实战3（Agent）': ['d21']
}

// 章节展示顺序按视频文件夹编号（更新记录置顶、加餐置底）
const CHAPTER_ORDER = [
  '01_更新记录',
  '02_学前必看',
  '03_代码介绍&应用启动',
  '04_大模型开发概述',
  '05_提示词工程',
  '06_初探Spring AI',
  '07_LangChain4j',
  '08_Function Call',
  '09_MCP',
  '10_RAG',
  '12_Workflow',
  '11_Agent',
  '13_上下文工程',
  '14_长期记忆',
  '16_Skills',
  '17_AgentScope（更新中）',
  '15_Harness（更新中）',
  '19_项目实战1（dodo-agent）',
  '20_项目实战2（know-engine）（更新中）',
  '21_RAG评测（更新中）',
  '24_面试专用（通用）',
  '25_面试专用（dodo-agent）',
  '26_面试专用（know-engine）',
  '18_大模型微调',
  '22_项目实战3（Agent）',
  '23_加餐'
]

// 视频名与文档标题对不上的篇目，人工指定课序
const DOC_ORDER_OVERRIDE = {
  '02_学前必看': {
    '✅课程介绍': 1,
    '✅【重要】课程如何答疑？': 2,
    '✅重要说明！！！！': 4,
    '✅【重要】代码如何下载？': 5
  },
  '10_RAG': {
    '✅什么是父子分片？': 72,
    '✅文档分片的代码实现': 72
  },
  '20_项目实战2（know-engine）（更新中）': {
    '✅项目整体架构与核心功能': 153,
    '✅项目亮点与设计原则': 153,
    '✅项目如何启动&快速开始': 158,
    '✅文档索引构建流程——文档上传': 158,
    '✅解决MinerU解析无法获取图片的问题': 165,
    '✅引入分布式锁解决文档处理的并发问题': 173,
    '✅分段批量插入性能优化': 175,
    '✅基于雪花算法生成唯一的chunkId': 175,
    '✅项目中多种格式的文档处理？': 176,
    '✅Excel文件如何处理？': 177,
    '✅表格&图片被拆分到多个分块如何解决？': 177,
    '✅混合检索如何实现？': 186,
    '✅基于langchain4j的多轮对话的实现': 198,
    '✅支持多轮对话后的问题重写踩坑与LLM对比': 199,
    '✅如何基于text2sql实现关系型数据查询?': 203,
    '✅RAG问题澄清——对话卡片的实现': 204,
    '✅支持图片的召回和渲染': 204
  },
  '21_RAG评测（更新中）': {
    '✅主流RAG评测框架：RAGAS、TruLens、DeepEval、Phoenix': 205,
    '✅RAG的评测数据集该如何准备？': 209,
    '✅怎样的评测集算是好的评测集？': 209,
    '✅评测脚本准备&开始运行评测': 212,
    '✅解决中文分词不准确导致召回效果差的问题': 213,
    '✅解决问题重写导致的召回不准问题': 214,
    '✅解决引用信息补全导致参考资料乱序问题': 217,
    '✅通过 minScore 解决召回准确率低的问题': 218,
    '✅通过修改ground truth，解决召回率低和答案准确率低的问题': 219,
    '✅通过优化系统提示词，提升答案正确性': 219,
    '✅通过换模型解决忠诚度低的问题': 220,
    '✅增加分层拒答能力，减少错误回答发生': 221
  }
}

function lessonNumFor(dir, title) {
  const override = DOC_ORDER_OVERRIDE[dir]?.[title]
  if (override !== undefined) return override
  if (!VIDEOS.length) return snapshotLessons[dir]?.[title]
  const pool = VIDEOS.filter((v) => (CHAPTER_SOURCES[dir] || []).includes(v.id))
  if (!pool.length) return undefined
  const key = normTitle(title)
  const exact = pool.find((v) => v.key === key)
  if (exact) return exact.num
  const prefixed = pool.find(
    (v) => Math.min(v.key.length, key.length) >= 6 && (v.key.startsWith(key) || key.startsWith(v.key))
  )
  if (prefixed) return prefixed.num
  let best = 0.55
  let num
  for (const v of pool) {
    const s = dice(key, v.key)
    if (s > best) {
      best = s
      num = v.num
    }
  }
  return num
}

const chapters = chapterDirs().map((dir) => {
  const match = dir.match(CHAPTER_RE)
  const title = match[2].trim()
  const files = fs
    .readdirSync(path.join(root, dir))
    .filter((f) => f.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }))

  const docs = files.map((f) => {
    const rel = `${dir}/${f}`
    return {
      rel,
      link: `/${rel.replace(/\.md$/, '')}`,
      title: readDocTitle(path.join(root, rel)),
      file: f.replace(/\.md$/, '')
    }
  })
  const lesson = new Map(docs.map((d) => [d.rel, lessonNumFor(dir, d.title)]))
  docs.sort(
    (a, b) =>
      (lesson.get(a.rel) ?? 1e9) - (lesson.get(b.rel) ?? 1e9) ||
      a.file.localeCompare(b.file, 'zh-Hans-CN', { numeric: true })
  )

  return {
    num: Number(match[1]),
    dir,
    slug: dir.replace(/[^0-9a-zA-Z]+/g, '-').replace(/^-|-$/g, '').toLowerCase(),
    title,
    ongoing: STATUS_RE.test(title),
    tags: tagsFor(title),
    docs
  }
})

chapters.sort(
  (a, b) =>
    (CHAPTER_ORDER.indexOf(a.dir) === -1 ? 99 : CHAPTER_ORDER.indexOf(a.dir)) -
    (CHAPTER_ORDER.indexOf(b.dir) === -1 ? 99 : CHAPTER_ORDER.indexOf(b.dir))
)
chapters.forEach((c, i) => {
  c.num = i + 1
})

const tagCounts = {}
for (const c of chapters) for (const t of c.tags) tagCounts[t] = (tagCounts[t] || 0) + 1

const meta = {
  generatedAt: new Date().toISOString(),
  totalChapters: chapters.length,
  totalDocs: chapters.reduce((n, c) => n + c.docs.length, 0),
  tags: Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count })),
  chapters
}

fs.mkdirSync(outDir, { recursive: true })

// 有视频目录时把匹配结果写成快照，供无视频环境（CI/其他机器）复现同一顺序
if (VIDEOS.length) {
  const lessons = {}
  for (const c of chapters) {
    const per = {}
    for (const d of c.docs) {
      const n = lessonNumFor(c.dir, d.title)
      if (n !== undefined) per[d.title] = n
    }
    if (Object.keys(per).length) lessons[c.dir] = per
  }
  fs.writeFileSync(
    ORDER_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), lessons }, null, 2),
    'utf8'
  )
}

fs.writeFileSync(
  path.join(outDir, 'chapters.json'),
  JSON.stringify(meta, null, 2),
  'utf8'
)

fs.writeFileSync(
  path.join(outDir, 'sidebar.json'),
  JSON.stringify(
    Object.fromEntries(
      chapters
        .filter((c) => c.docs.length)
        .map((c) => [
          `/${c.dir}/`,
          {
            text: `${String(c.num).padStart(2, '0')} ${c.title}`,
            collapsed: true,
            items: c.docs.map((d) => ({ text: d.title, link: d.link }))
          }
        ])
    ),
    null,
    2
  ),
  'utf8'
)

const index = `---
layout: home
hero:
  name: 曹哥
  text: AI Agent 开发课程文档站
  tagline: ${meta.totalChapters} 个章节 / ${meta.totalDocs} 篇文档 · 全文搜索 · 按章节分类浏览
  actions:
    - theme: brand
      text: 从学前必看开始
      link: ${chapters.find((c) => c.docs.length)?.docs[0].link ?? '/'}
    - theme: alt
      text: 浏览全部章节
      link: /#chapters
---

<ChapterBrowser />
`

fs.writeFileSync(path.join(root, 'index.md'), index, 'utf8')

console.log(
  `chapters: ${meta.totalChapters} (empty: ${chapters.filter((c) => !c.docs.length).map((c) => c.dir).join(', ') || 'none'}), docs: ${meta.totalDocs}, tags: ${meta.tags.length}`
)
