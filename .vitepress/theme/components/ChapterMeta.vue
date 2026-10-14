<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'
import data from '../../chapters.json'

const { page } = useData()

const chapter = computed(() =>
  data.chapters.find((c) => page.value.relativePath.startsWith(`${c.dir}/`))
)
</script>

<template>
  <div v-if="chapter" class="chapter-meta">
    <a class="chapter-meta__chapter" href="/#chapters">
      第{{ String(chapter.num).padStart(2, '0') }} 章 · {{ chapter.title }}
    </a>
    <span class="chapter-meta__count">{{ chapter.docs.length }} 篇</span>
    <a
      v-for="tag in chapter.tags"
      :key="tag"
      class="chapter-meta__tag"
      :href="`/#tag-${encodeURIComponent(tag)}`"
      >{{ tag }}</a
    >
  </div>
</template>

<style scoped>
.chapter-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin: 0.75rem 0 1.5rem;
  padding: 0.6rem 0.85rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  font-size: 0.82rem;
}
.chapter-meta__chapter {
  font-weight: 600;
  color: var(--vp-c-brand-1);
}
.chapter-meta__count {
  color: var(--vp-c-text-3);
}
.chapter-meta__tag {
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-2);
}
.chapter-meta__tag:hover {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}
</style>
