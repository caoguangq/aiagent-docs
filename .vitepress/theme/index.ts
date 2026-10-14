import { h, type App } from 'vue'
import DefaultTheme from 'vitepress/theme'
import ChapterBrowser from './components/ChapterBrowser.vue'
import ChapterMeta from './components/ChapterMeta.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'doc-top': () => h(ChapterMeta)
    }),
  enhanceApp({ app }: { app: App }) {
    app.component('ChapterBrowser', ChapterBrowser)
  }
}
