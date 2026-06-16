<script setup lang="ts">
import { computed } from "vue";
import { useData } from "vitepress";
import type { TopicPost } from "../../../topics/posts.data";

const props = defineProps<{
  posts: TopicPost[];
}>();

const { lang } = useData();

const isChinese = computed(() => lang.value.startsWith("zh"));
const copy = computed(() => ({
  eyebrow: isChinese.value ? "个人工程笔记" : "Personal engineering notebook",
  introTitle: isChinese.value
    ? "把一次次工程判断，整理成能反复回看的文章。"
    : "Turning recurring engineering decisions into notes worth revisiting.",
  introBody: isChinese.value
    ? "这里不追逐碎片化热点，更关注基础设施、分布式系统、服务治理、数据库和语言工程里那些会长期反复出现的问题。"
    : "This site is less about fleeting trends and more about the questions that keep returning in infrastructure, distributed systems, service governance, databases, and language engineering.",
  featuredTitle: isChinese.value ? "精选阅读" : "Featured essays",
  latestTitle: isChinese.value ? "最近更新" : "Recently updated",
  pathsTitle: isChinese.value ? "阅读路径" : "Reading paths",
  pathsBody: isChinese.value
    ? "按长期问题域进入，而不是按发布时间硬翻目录。"
    : "Enter by long-lived problem domains rather than only by publication date.",
  archiveText: isChinese.value ? "查看全部文章" : "Open the full archive",
  archiveHref: isChinese.value ? "/zh/topics/" : "/topics/",
  updatedLabel: isChinese.value ? "更新" : "Updated",
  postsLabel: isChinese.value ? "篇文章" : "posts",
  categoryLabel: isChinese.value ? "个主题" : "categories",
  latestLabel: isChinese.value ? "最近更新" : "latest update"
}));

const preferredSlugs = ["connection-pool", "ddd", "spring-config", "go-boot", "nonetype"];

const slugFromUrl = (url: string) => {
  const parts = url.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
};

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

const categories = computed(() => {
  const groups = new Map<string, TopicPost[]>();

  props.posts.forEach((post) => {
    const current = groups.get(post.category) ?? [];
    current.push(post);
    groups.set(post.category, current);
  });

  return groups;
});

const categoryCount = computed(() => categories.value.size);

const latestDate = computed(() => {
  const first = props.posts[0];
  return first ? formatDate(first.updatedAt) : "-";
});

const featuredPosts = computed(() => {
  const bySlug = new Map(props.posts.map((post) => [slugFromUrl(post.url), post]));
  const selected = preferredSlugs
    .map((slug) => bySlug.get(slug))
    .filter((post): post is TopicPost => Boolean(post));
  const selectedUrls = new Set(selected.map((post) => post.url));
  const fallback = props.posts.filter((post) => !selectedUrls.has(post.url));

  return [...selected, ...fallback].slice(0, 4);
});

const latestPosts = computed(() => props.posts.slice(0, 5));

const readingPathOrder = computed(() =>
  isChinese.value
    ? ["数据库", "Java 工程", "服务治理", "Go 工程", "分布式系统", "可观测性"]
    : ["Database", "Java Engineering", "Service Governance", "Golang Engineering", "Distributed Systems", "Observability"]
);

const readingPaths = computed(() => {
  const groups = categories.value;
  const preferred = readingPathOrder.value
    .map((category) => {
      const posts = groups.get(category);
      return posts ? { category, posts } : null;
    })
    .filter((item): item is { category: string; posts: TopicPost[] } => Boolean(item));

  const seen = new Set(preferred.map((item) => item.category));
  const rest = Array.from(groups.entries())
    .filter(([category]) => !seen.has(category))
    .sort((left, right) => right[1].length - left[1].length)
    .map(([category, posts]) => ({ category, posts }));

  return [...preferred, ...rest].slice(0, 6);
});
</script>

<template>
  <div class="blog-home">
    <section class="blog-home__intro">
      <div>
        <p class="blog-home__eyebrow">{{ copy.eyebrow }}</p>
        <h2>{{ copy.introTitle }}</h2>
        <p>{{ copy.introBody }}</p>
      </div>
      <dl class="blog-home__stats">
        <div>
          <dt>{{ copy.postsLabel }}</dt>
          <dd>{{ posts.length }}</dd>
        </div>
        <div>
          <dt>{{ copy.categoryLabel }}</dt>
          <dd>{{ categoryCount }}</dd>
        </div>
        <div>
          <dt>{{ copy.latestLabel }}</dt>
          <dd>{{ latestDate }}</dd>
        </div>
      </dl>
    </section>

    <section class="blog-home__section">
      <div class="blog-home__section-head">
        <h2>{{ copy.featuredTitle }}</h2>
        <a :href="copy.archiveHref">{{ copy.archiveText }}</a>
      </div>
      <div class="blog-home__featured-grid">
        <a v-for="post in featuredPosts" :key="post.url" class="blog-home__feature" :href="post.url">
          <span>{{ post.category }}</span>
          <h3>{{ post.title }}</h3>
          <p>{{ post.summary }}</p>
        </a>
      </div>
    </section>

    <section class="blog-home__section">
      <div class="blog-home__section-head">
        <div>
          <h2>{{ copy.pathsTitle }}</h2>
          <p>{{ copy.pathsBody }}</p>
        </div>
      </div>
      <div class="blog-home__path-grid">
        <a
          v-for="path in readingPaths"
          :key="path.category"
          class="blog-home__path"
          :href="copy.archiveHref"
        >
          <strong>{{ path.category }}</strong>
          <span>{{ path.posts.length }} {{ copy.postsLabel }}</span>
        </a>
      </div>
    </section>

    <section class="blog-home__section blog-home__section--split">
      <div class="blog-home__section-head">
        <h2>{{ copy.latestTitle }}</h2>
      </div>
      <div class="blog-home__latest-list">
        <a v-for="post in latestPosts" :key="post.url" :href="post.url">
          <span>{{ copy.updatedLabel }} {{ formatDate(post.updatedAt) }}</span>
          <strong>{{ post.title }}</strong>
        </a>
      </div>
    </section>
  </div>
</template>
