import { defineConfig } from 'vitepress'
import { fileURLToPath } from 'node:url'
import chapters from './chapters.json'
import sidebar from './sidebar.json'
import {
  escapeStrayHtml,
  fixEmptyTableHeaders,
  reflowCodeBlocks,
  removeDuplicateTitle,
  rewriteMissingImages
} from './md-normalize.mjs'

export default defineConfig({
  lang: 'zh-CN',
  title: '曹哥 · AI Agent 课程文档',
  titleTemplate: ':title · 曹哥',
  description: `${chapters.totalDocs} 篇 AI Agent 开发课程文档，支持全文搜索与章节分类浏览。`,
  // GitHub Pages 不做 /foo → foo.html 重写，链接保留 .html 后缀；base 由 CI 按仓库名注入
  base: process.env.VITEPRESS_BASE || '/',
  cleanUrls: false,
  lastUpdated: true,
  // 源文档里有占位图片链接（xxx.png）与失效外链，逐页人工修不现实。
  ignoreDeadLinks: true,
  head: [
    ['link', { rel: 'icon', href: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📘</text></svg>' }]
  ],
  srcExclude: ['scripts/**', 'node_modules/**', 'package.json', 'package-lock.json'],
  markdown: {
    // 让每篇文档开头的「原文链接：https://…」变成可点击外链
    linkify: true,
    image: { lazyLoading: true },
    theme: { light: 'github-light', dark: 'github-dark' },
    config: (md) => {
      const srcDir = fileURLToPath(new URL('..', import.meta.url))
      md.use(escapeStrayHtml)
      md.use(fixEmptyTableHeaders)
      md.use(removeDuplicateTitle)
      md.use(reflowCodeBlocks)
      md.use(rewriteMissingImages, { srcDir })
    }
  },
  vite: {
    server: { host: true }
  },
  themeConfig: {
    nav: [{ text: '首页', link: '/' }, { text: '章节导航', link: '/#chapters' }],
    sidebar,
    sidebarMenuLabel: '目录',
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdatedText: '最后更新',
    returnToTopLabel: '回到顶部',
    darkModeSwitchLabel: '外观',
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            displayDetails: '显示详情',
            resetButtonTitle: '重置',
            backButtonTitle: '关闭',
            noResultsText: '没有找到相关内容',
            footer: {
              selectText: '选择',
              navigateText: '切换',
              closeText: '关闭'
            }
          }
        },
        _minSearchLength: 1,
        _maxSuggestionResults: 20
      }
    },
    footer: {
      message: '本地文档站 · 由 VitePress 生成',
      copyright: `${chapters.totalChapters} 个章节 / ${chapters.totalDocs} 篇文档`
    }
  }
})
