<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { withBase } from 'vitepress'
import data from '../../chapters.json'

const keyword = ref('')
const activeTag = ref<string | null>(null)
const expanded = ref<number[]>([])

const normalizedKeyword = computed(() => keyword.value.trim().toLowerCase())

const visible = computed(() =>
  data.chapters.filter((chapter) => {
    if (activeTag.value && !chapter.tags.includes(activeTag.value)) return false
    if (!normalizedKeyword.value) return true
    return (
      chapter.title.toLowerCase().includes(normalizedKeyword.value) ||
      chapter.docs.some((doc) => doc.title.toLowerCase().includes(normalizedKeyword.value))
    )
  })
)

const matchCount = computed(() =>
  visible.value.reduce((sum, chapter) => sum + chapter.docs.length, 0)
)

function isExpanded(num: number) {
  return expanded.value.includes(num)
}

function toggle(num: number) {
  expanded.value = isExpanded(num)
    ? expanded.value.filter((n) => n !== num)
    : [...expanded.value, num]
}

function shownDocs(chapter: (typeof data.chapters)[number]) {
  if (isExpanded(chapter.num) || !normalizedKeyword.value) {
    return isExpanded(chapter.num) ? chapter.docs : chapter.docs.slice(0, 5)
  }
  return chapter.docs.filter((doc) =>
    doc.title.toLowerCase().includes(normalizedKeyword.value)
  )
}

function pickTag(tag: string | null) {
  activeTag.value = activeTag.value === tag ? null : tag
}

onMounted(() => {
  const hash = decodeURIComponent(window.location.hash)
  if (hash.startsWith('#tag-')) activeTag.value = hash.slice(5) || null
})
</script>

<template>
  <section id="chapters" class="browser">
    <h2 class="browser__heading">章节导航</h2>

    <div class="browser__toolbar">
      <input
        v-model="keyword"
        class="browser__input"
        type="search"
        placeholder="按章节或文档标题筛选，例如 MCP、面试、微调"
        aria-label="按章节筛选文档"
      />
      <span class="browser__stat">
        {{ visible.length }} 个章节 · {{ matchCount }} 篇文档
      </span>
    </div>

    <div class="browser__tags">
      <button
        class="browser__tag"
        :class="{ 'is-active': activeTag === null }"
        @click="pickTag(null)"
      >
        全部
      </button>
      <button
        v-for="tag in data.tags"
        :key="tag.name"
        class="browser__tag"
        :class="{ 'is-active': activeTag === tag.name }"
        @click="pickTag(tag.name)"
      >
        {{ tag.name }}<span class="browser__tag-count">{{ tag.count }}</span>
      </button>
    </div>

    <div class="browser__grid">
      <article v-for="chapter in visible" :key="chapter.num" class="card">
        <header class="card__head">
          <a class="card__title" :href="withBase(chapter.docs[0]?.link ?? '/')">
            <span class="card__num">{{ String(chapter.num).padStart(2, '0') }}</span>
            {{ chapter.title }}
          </a>
          <span class="card__count">{{ chapter.docs.length }} 篇</span>
        </header>

        <p v-if="!chapter.docs.length" class="card__empty">该章节暂无文档，待课程更新。</p>

        <ul v-else class="card__docs">
          <li v-for="doc in shownDocs(chapter)" :key="doc.rel">
            <a :href="withBase(doc.link)">{{ doc.title }}</a>
          </li>
        </ul>

        <div class="card__foot">
          <div class="card__tags">
            <button
              v-for="tag in chapter.tags"
              :key="tag"
              class="card__tag"
              @click="pickTag(tag)"
            >
              {{ tag }}
            </button>
          </div>
          <button
            v-if="chapter.docs.length > 5"
            class="card__toggle"
            @click="toggle(chapter.num)"
          >
            {{ isExpanded(chapter.num) ? '收起' : `展开全部 ${chapter.docs.length} 篇` }}
          </button>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.browser {
  max-width: 1152px;
  margin: 0 auto;
  padding: 0 24px 48px;
}
.browser__heading {
  margin: 0 0 16px;
  border-top: none;
  padding-top: 0;
  font-size: 1.4rem;
  letter-spacing: 0.01em;
}
.browser__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.browser__input {
  flex: 1 1 280px;
  max-width: 420px;
  padding: 8px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-size: 0.9rem;
}
.browser__input:focus {
  outline: none;
  border-color: var(--vp-c-brand-1);
}
.browser__stat {
  color: var(--vp-c-text-3);
  font-size: 0.82rem;
}
.browser__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0 24px;
}
.browser__tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  font-size: 0.8rem;
  cursor: pointer;
}
.browser__tag:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
.browser__tag.is-active {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
.browser__tag-count {
  color: var(--vp-c-text-3);
  font-size: 0.72rem;
}
.browser__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
}
.card__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.card__title {
  font-weight: 600;
  color: var(--vp-c-text-1);
  line-height: 1.4;
}
.card__title:hover {
  color: var(--vp-c-brand-1);
}
.card__num {
  margin-right: 6px;
  color: var(--vp-c-brand-1);
  font-variant-numeric: tabular-nums;
}
.card__count {
  flex-shrink: 0;
  color: var(--vp-c-text-3);
  font-size: 0.75rem;
}
.card__empty {
  margin: 0;
  color: var(--vp-c-text-3);
  font-size: 0.85rem;
}
.card__docs {
  margin: 0;
  padding-left: 18px;
  list-style: disc;
}
.card__docs li {
  font-size: 0.85rem;
  line-height: 1.7;
}
.card__docs a {
  color: var(--vp-c-text-2);
}
.card__docs a:hover {
  color: var(--vp-c-brand-1);
}
.card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
}
.card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.card__tag {
  padding: 2px 8px;
  border: none;
  border-radius: 999px;
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-2);
  font-size: 0.72rem;
  cursor: pointer;
}
.card__tag:hover {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}
.card__toggle {
  border: none;
  background: none;
  color: var(--vp-c-brand-1);
  font-size: 0.78rem;
  cursor: pointer;
}
</style>
