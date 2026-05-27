<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useData } from "vitepress";
import type { TopicPost } from "../../../topics/posts.data";

const props = defineProps<{
  posts: TopicPost[];
}>();

const { lang } = useData();

const isChinese = computed(() => lang.value.startsWith("zh"));
const copy = computed(() => ({
  tagSearchTitle: isChinese.value ? "Tag 搜索" : "Tag search",
  tagSearchDesc: isChinese.value
    ? "输入 tag 关键词，查看 tag 与文章的倒排索引。"
    : "Search tags and inspect the inverted article index.",
  tagSearchPlaceholder: isChinese.value
    ? "搜索 tag，例如：OpenTelemetry"
    : "Search tag, for example: OpenTelemetry",
  tagSearchHint: isChinese.value
    ? "输入关键词后显示匹配 tag 及对应文章。"
    : "Type a keyword to show matched tags and linked posts.",
  tagSearchEmpty: isChinese.value ? "没有匹配的 tag。" : "No matched tags.",
  clearSearch: isChinese.value ? "清除" : "Clear",
  postCountSuffix: isChinese.value ? "篇文章" : "posts",
  latestTitle: isChinese.value ? "最近更新" : "Recently updated",
  publishLabel: isChinese.value ? "发布" : "Published",
  updateLabel: isChinese.value ? "更新" : "Updated",
  readingDirectionLabel: isChinese.value ? "阅读方向：" : "Reading direction:",
  emptyState: isChinese.value ? "当前标签下还没有文章。" : "No posts match the selected tag yet.",
  categoryTitle: isChinese.value ? "按主题分类" : "Browse by category",
  categoryDesc: isChinese.value
    ? "按问题域归拢，而不是按传统专题策展方式组织。"
    : "Grouped by problem domain instead of a traditional editorial sequence.",
  archiveTitle: isChinese.value ? "按年份归档" : "Archive by year",
  unknownYear: isChinese.value ? "未知" : "Unknown"
}));

const tagQuery = ref("");
const selectedTag = ref("");

const normalizeSearch = (value: string) => value.trim().toLowerCase();

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(isChinese.value ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
};

const tagIndexRows = computed(() => {
  const tagIndex = new Map<string, TopicPost[]>();

  props.posts.forEach((post) => {
    post.tags.forEach((tag) => {
      const posts = tagIndex.get(tag) ?? [];
      posts.push(post);
      tagIndex.set(tag, posts);
    });
  });

  return Array.from(tagIndex.entries())
    .map(([tag, posts]) => ({ tag, posts }))
    .sort((left, right) => left.tag.localeCompare(right.tag));
});

const matchedTagRows = computed(() => {
  const keyword = normalizeSearch(tagQuery.value);

  if (!keyword) {
    return [];
  }

  return tagIndexRows.value.filter((row) => normalizeSearch(row.tag).includes(keyword));
});

const filteredPosts = computed(() => {
  if (!selectedTag.value) {
    return props.posts;
  }

  return props.posts.filter((post) => post.tags.includes(selectedTag.value));
});

const groupedPosts = computed(() => {
  const groups = new Map<string, TopicPost[]>();

  filteredPosts.value.forEach((post) => {
    const current = groups.get(post.category) ?? [];
    current.push(post);
    groups.set(post.category, current);
  });

  return Array.from(groups.entries()).map(([category, posts]) => ({
    category,
    posts
  }));
});

const archivedPosts = computed(() => {
  const groups = new Map<string, TopicPost[]>();

  filteredPosts.value.forEach((post) => {
    const date = new Date(post.publishAt);
    const year = Number.isNaN(date.getTime()) ? copy.value.unknownYear : String(date.getFullYear());
    const current = groups.get(year) ?? [];
    current.push(post);
    groups.set(year, current);
  });

  return Array.from(groups.entries())
    .sort((left, right) => right[0].localeCompare(left[0]))
    .map(([year, posts]) => ({
      year,
      posts
    }));
});

const formatPostCount = (count: number) => `${count} ${copy.value.postCountSuffix}`;

const clearTagQuery = () => {
  tagQuery.value = "";
  selectedTag.value = "";
};

const selectTag = (tag: string) => {
  tagQuery.value = tag;
  selectedTag.value = tag;
};

watch(tagQuery, (value) => {
  if (normalizeSearch(value) !== normalizeSearch(selectedTag.value)) {
    selectedTag.value = "";
  }
});
</script>

<template>
  <div class="forum-index">
    <section class="forum-section forum-section--compact">
      <div class="forum-section__head">
        <h2>{{ copy.tagSearchTitle }}</h2>
        <p>{{ copy.tagSearchDesc }}</p>
      </div>

      <div class="forum-tag-search">
        <input
          v-model="tagQuery"
          type="search"
          :placeholder="copy.tagSearchPlaceholder"
          :aria-label="copy.tagSearchTitle"
        />
        <button v-if="tagQuery" type="button" @click="clearTagQuery">
          {{ copy.clearSearch }}
        </button>
      </div>

      <p v-if="!tagQuery.trim()" class="forum-tag-search__hint">{{ copy.tagSearchHint }}</p>
      <div v-else-if="matchedTagRows.length" class="forum-tag-index">
        <article v-for="row in matchedTagRows" :key="row.tag" class="forum-tag-index__row">
          <div class="forum-tag-index__head">
            <button
              type="button"
              class="forum-tag-index__tag"
              @click="selectTag(row.tag)"
            >
              {{ row.tag }}
            </button>
            <span>{{ formatPostCount(row.posts.length) }}</span>
          </div>
          <ul>
            <li v-for="post in row.posts" :key="post.url">
              <a :href="post.url">{{ post.title }}</a>
              <span>{{ post.category }}</span>
            </li>
          </ul>
        </article>
      </div>
      <p v-else class="forum-tag-search__hint">{{ copy.tagSearchEmpty }}</p>
    </section>

    <section class="forum-section">
      <div class="forum-section__head">
        <h2>{{ copy.latestTitle }}</h2>
      </div>
      <div class="forum-post-grid">
        <a
          v-for="post in filteredPosts"
          :key="post.url"
          class="forum-post-card"
          :href="post.url"
        >
          <div class="forum-post-card__meta">
            <span class="forum-post-card__category">{{ post.category }}</span>
            <span class="forum-post-card__date">{{ copy.publishLabel }} {{ formatDate(post.publishAt) }}</span>
            <span class="forum-post-card__date">{{ copy.updateLabel }} {{ formatDate(post.updatedAt) }}</span>
          </div>
          <h3>{{ post.title }}</h3>
          <p class="forum-post-card__summary">{{ post.summary }}</p>
          <p class="forum-post-card__direction">
            <strong>{{ copy.readingDirectionLabel }}</strong>{{ post.readingDirection }}
          </p>
        </a>
      </div>
      <p v-if="!filteredPosts.length" class="forum-empty-state">{{ copy.emptyState }}</p>
    </section>

    <section class="forum-section">
      <div class="forum-section__head">
        <h2>{{ copy.categoryTitle }}</h2>
        <p>{{ copy.categoryDesc }}</p>
      </div>
      <div class="forum-category-grid">
        <div v-for="group in groupedPosts" :key="group.category" class="forum-category-card">
          <h3>{{ group.category }}</h3>
          <ul>
            <li v-for="post in group.posts" :key="post.url">
              <a :href="post.url">{{ post.title }}</a>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <section class="forum-section">
      <div class="forum-section__head">
        <h2>{{ copy.archiveTitle }}</h2>
      </div>
      <div class="forum-archive-list">
        <div v-for="archive in archivedPosts" :key="archive.year" class="forum-archive-card">
          <h3>{{ archive.year }}</h3>
          <ul>
            <li v-for="post in archive.posts" :key="post.url">
              <a :href="post.url">{{ post.title }}</a>
              <span>{{ formatDate(post.publishAt) }}</span>
            </li>
          </ul>
        </div>
      </div>
    </section>

  </div>
</template>
