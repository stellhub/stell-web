import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const docsRoot = path.resolve(repoRoot, "docs");
const contentRoot = path.resolve(repoRoot, "content", "topics");

const exists = async (target) => {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
};

const ensureDir = async (target) => {
  await mkdir(path.dirname(target), { recursive: true });
};

const writeDoc = async (relativePath, content) => {
  const target = path.resolve(docsRoot, relativePath);
  await ensureDir(target);
  await writeFile(target, `${content.trim()}\n`, "utf8");
};

const readJson = async (target) => JSON.parse(await readFile(target, "utf8"));

const walkTopicDirs = async (dir) => {
  const result = [];
  if (!(await exists(dir))) {
    return result;
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const hasMeta = entries.some((entry) => entry.isFile() && entry.name === "meta.json");
  if (hasMeta) {
    result.push(dir);
    return result;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    result.push(...(await walkTopicDirs(path.join(dir, entry.name))));
  }

  return result;
};

const requireText = (value, field, topicDir) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing ${field} in ${topicDir}`);
  }

  return value.trim();
};

const requireStringArray = (value, field, topicDir) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`Missing ${field} in ${topicDir}`);
  }

  return value.map((item) => item.trim());
};

const readTopic = async (topicDir) => {
  const meta = await readJson(path.join(topicDir, "meta.json"));
  const slug = requireText(meta.slug, "slug", topicDir);
  const zhPath = path.join(topicDir, "zh.md");
  const enPath = path.join(topicDir, "en.md");

  if (!(await exists(zhPath))) {
    throw new Error(`Missing zh.md for ${slug}`);
  }

  if (!(await exists(enPath))) {
    throw new Error(`Missing en.md for ${slug}`);
  }

  return {
    slug,
    title: {
      en: requireText(meta.title?.en, "title.en", topicDir),
      zh: requireText(meta.title?.zh, "title.zh", topicDir)
    },
    category: {
      en: requireText(meta.category?.en, "category.en", topicDir),
      zh: requireText(meta.category?.zh, "category.zh", topicDir)
    },
    summary: {
      en: requireText(meta.summary?.en, "summary.en", topicDir),
      zh: requireText(meta.summary?.zh, "summary.zh", topicDir)
    },
    tags: {
      en: requireStringArray(meta.tags?.en, "tags.en", topicDir),
      zh: requireStringArray(meta.tags?.zh, "tags.zh", topicDir)
    },
    readingDirection: {
      en: requireText(meta.readingDirection?.en, "readingDirection.en", topicDir),
      zh: requireText(meta.readingDirection?.zh, "readingDirection.zh", topicDir)
    },
    body: {
      en: (await readFile(enPath, "utf8")).trim(),
      zh: (await readFile(zhPath, "utf8")).trim()
    },
    sourceDir: topicDir
  };
};

const readTopics = async () => {
  const topicDirs = await walkTopicDirs(contentRoot);
  const topics = await Promise.all(topicDirs.map(readTopic));
  const seen = new Set();

  for (const topic of topics) {
    if (seen.has(topic.slug)) {
      throw new Error(`Duplicate topic slug: ${topic.slug}`);
    }

    seen.add(topic.slug);
  }

  return topics.sort((left, right) => left.slug.localeCompare(right.slug));
};

const yamlString = (value) => JSON.stringify(value);

const yamlList = (values) => values.map((value) => `  - ${yamlString(value)}`).join("\n");

const zhTopicLink = (slug) => `/zh/topics/${slug}`;

const stripLeadingTitle = (body) => body.replace(/^# .*\n+/, "").trim();

const renderHomePage = () => `---
layout: home
hero:
  name: Stell Forum
  text: Personal Engineering Notes
  tagline: Long-form notes on infrastructure, distributed systems, service governance, databases, and language engineering.
  actions:
    - theme: brand
      text: Start Reading
      link: /topics/
    - theme: alt
      text: Discuss on GitHub
      link: https://github.com/stellhub/stell-web/discussions
---

<script setup>
import BlogHome from "./.vitepress/theme/components/BlogHome.vue";
import { data as topicPosts } from "./topics/posts.data.ts";
</script>

<div id="blog-home">
  <BlogHome :posts="topicPosts" />
</div>`;

const renderZhHomePage = () => `---
layout: home
hero:
  name: Stell 论坛
  text: 个人工程笔记
  tagline: 长期记录基础设施、分布式系统、服务治理、数据库与语言工程里的判断过程。
  actions:
    - theme: brand
      text: 开始阅读
      link: /zh/topics/
    - theme: alt
      text: GitHub 讨论区
      link: https://github.com/stellhub/stell-web/discussions
---

<script setup>
import BlogHome from "../.vitepress/theme/components/BlogHome.vue";
import { data as topicPosts } from "./topics/posts.data.ts";
</script>

<div id="blog-home">
  <BlogHome :posts="topicPosts" />
</div>`;

const renderTopicsIndex = () => `---
layout: home
hero:
  name: Writing Archive
  text: All Posts and Notes
  tagline: Search the complete writing archive by tag, category, update time, and long-term engineering problem domain.
  actions:
    - theme: brand
      text: Browse Archive
      link: "#forum-latest"
    - theme: alt
      text: Back Home
      link: /
---

<script setup>
import ForumPostIndex from "../.vitepress/theme/components/ForumPostIndex.vue";
import { data as topicPosts } from "./posts.data.ts";
</script>

<div id="forum-latest">
  <ForumPostIndex :posts="topicPosts" />
</div>`;

const renderZhTopicsIndex = () => `---
layout: home
hero:
  name: 文章归档
  text: 全部文章与笔记
  tagline: 按标签、分类、更新时间和长期工程问题域检索完整文章库。
  actions:
    - theme: brand
      text: 浏览全部文章
      link: "#forum-latest"
    - theme: alt
      text: 返回站点首页
      link: /zh/
---

<script setup>
import ForumPostIndex from "../../.vitepress/theme/components/ForumPostIndex.vue";
import { data as topicPosts } from "./posts.data.ts";
</script>

<div id="forum-latest">
  <ForumPostIndex :posts="topicPosts" />
</div>`;

const renderTopicPage = (topic, locale) => {
  const isZh = locale === "zh";
  const title = isZh ? topic.title.zh : topic.title.en;
  const category = isZh ? topic.category.zh : topic.category.en;
  const summary = isZh ? topic.summary.zh : topic.summary.en;
  const tags = isZh ? topic.tags.zh : topic.tags.en;
  const readingDirection = isZh ? topic.readingDirection.zh : topic.readingDirection.en;
  const body = stripLeadingTitle(isZh ? topic.body.zh : topic.body.en);
  const overviewTitle = isZh ? "概览" : "Overview";
  const reference = isZh
    ? ""
    : `

## Chinese Reference

- [Read the original Chinese article](${zhTopicLink(topic.slug)})`;

  return `---
title: ${yamlString(title)}
category: ${yamlString(category)}
summary: ${yamlString(summary)}
tags:
${yamlList(tags)}
readingDirection: ${yamlString(readingDirection)}
outline: deep
---

# ${title}

## ${overviewTitle}

${summary}

${body}${reference}`;
};

const renderTopicData = (locale) => {
  const zh = locale === "zh";
  const rootOffset = zh ? "../../.." : "../..";
  const glob = zh ? "zh/topics/*.md" : "topics/*.md";
  const ignore = zh ? "zh/topics/index.md" : "topics/index.md";
  const fallbackCategory = zh ? "未分类" : "Uncategorized";

  return `import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { createContentLoader } from "vitepress";

export interface TopicPost {
  title: string;
  url: string;
  category: string;
  summary: string;
  tags: string[];
  readingDirection: string;
  publishAt: string;
  updatedAt: string;
}

const REPO_ROOT = path.resolve(__dirname, "${rootOffset}");
const DOCS_ROOT = path.resolve(REPO_ROOT, "docs");

const getGitDate = (filePath: string, args: string[]) => {
  try {
    const value = execFileSync("git", ["-C", REPO_ROOT, ...args, "--", filePath], {
      encoding: "utf-8"
    }).trim();
    return value || "";
  } catch {
    return "";
  }
};

const getFallbackDate = (filePath: string) => statSync(filePath).mtime.toISOString();

const resolveTopicFile = (url: string) =>
  path.resolve(DOCS_ROOT, \`\${url.replace(/^\\//, "").replace(/\\/$/, "")}.md\`);

export default createContentLoader("${glob}", {
  globOptions: {
    ignore: ["${ignore}"]
  },
  transform(rawPosts) {
    return rawPosts
      .filter((post) => post.url !== "${zh ? "/zh/topics/" : "/topics/"}")
      .map<TopicPost>((post) => {
        const filePath = resolveTopicFile(post.url);
        const publishAt =
          getGitDate(filePath, ["log", "--diff-filter=A", "-1", "--format=%aI"]) ||
          getFallbackDate(filePath);
        const updatedAt =
          getGitDate(filePath, ["log", "-1", "--format=%cI"]) ||
          getFallbackDate(filePath);

        return {
          title: post.frontmatter.title ?? "",
          url: post.url,
          category: post.frontmatter.category ?? "${fallbackCategory}",
          summary: post.frontmatter.summary ?? "",
          tags: Array.isArray(post.frontmatter.tags) ? post.frontmatter.tags : [],
          readingDirection: post.frontmatter.readingDirection ?? "",
          publishAt,
          updatedAt
        };
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
});`;
};

const cleanGeneratedTopicPages = async (relativeDir) => {
  const targetDir = path.resolve(docsRoot, relativeDir);
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(targetDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "index.md") {
      continue;
    }

    await rm(path.join(targetDir, entry.name));
  }
};

const generateDocs = async () => {
  const topics = await readTopics();

  await cleanGeneratedTopicPages("topics");
  await cleanGeneratedTopicPages(path.join("zh", "topics"));

  await writeDoc("index.md", renderHomePage());
  await writeDoc(path.join("zh", "index.md"), renderZhHomePage());
  await writeDoc(path.join("topics", "index.md"), renderTopicsIndex());
  await writeDoc(path.join("zh", "topics", "index.md"), renderZhTopicsIndex());
  await writeDoc(path.join("topics", "posts.data.ts"), renderTopicData("en"));
  await writeDoc(path.join("zh", "topics", "posts.data.ts"), renderTopicData("zh"));

  for (const topic of topics) {
    await writeDoc(path.join("topics", `${topic.slug}.md`), renderTopicPage(topic, "en"));
    await writeDoc(path.join("zh", "topics", `${topic.slug}.md`), renderTopicPage(topic, "zh"));
  }
};

await generateDocs();
