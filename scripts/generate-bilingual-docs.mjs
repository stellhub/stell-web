import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { topics } from "./bilingual-metadata.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const docsRoot = path.resolve(repoRoot, "docs");
const zhRoot = path.resolve(docsRoot, "zh");
const topicDocRoot = path.resolve(repoRoot, "scripts", "topic-docs");

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

const stripGeneratedTopicShell = (source) =>
  source
    .replace(/^---[\s\S]*?---\s*/, "")
    .replace(/^# .*\n+## Overview\n+[\s\S]*?\n+(?=## )/, "")
    .replace(/\n+## Chinese Reference\n+\n+- \[Read the original Chinese article\]\([^)]+\)\n?/, "\n")
    .trim();

const rewriteChineseLinks = (source) =>
  source
    .replace(/href="\/topics\//g, 'href="/zh/topics/')
    .replace(/\]\(\/topics\//g, "](/zh/topics/")
    .replace(
      /\.\.\/\.vitepress\/theme\/components\/ForumPostIndex\.vue/g,
      "../../.vitepress/theme/components/ForumPostIndex.vue"
    )
    .replace(/(^\s*link:\s*)\/topics\/\s*$/gm, "$1/zh/topics/")
    .replace(/(^\s*link:\s*)\/\s*$/gm, "$1/zh/")
    .replace(/\]\(\/\)/g, "](/zh/)");

const copyChineseSource = async (sourceDir, targetDir) => {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  await mkdir(targetDir, { recursive: true });

  for (const entry of entries) {
    if (
      entry.name === ".vitepress" ||
      entry.name === "public" ||
      entry.name === "logo" ||
      entry.name === "products" ||
      entry.name === "zh"
    ) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyChineseSource(sourcePath, targetPath);
      continue;
    }

    if (entry.name === "posts.data.ts") {
      continue;
    }

    if (entry.name.endsWith(".md")) {
      const content = await readFile(sourcePath, "utf8");
      await ensureDir(targetPath);
      await writeFile(targetPath, rewriteChineseLinks(content), "utf8");
      continue;
    }

    await ensureDir(targetPath);
    await copyFile(sourcePath, targetPath);
  }
};

const writeDoc = async (relativePath, content) => {
  const target = path.resolve(docsRoot, relativePath);
  await ensureDir(target);
  await writeFile(target, `${content.trim()}\n`, "utf8");
};

const zhTopicLink = (slug) => `/zh/topics/${slug}`;

const renderYamlTitle = (value, preferQuoted = false) =>
  preferQuoted || /:\s/.test(value) ? JSON.stringify(value) : value;

const existingTopicTitleIsQuoted = async (topic) => {
  const generatedPath = path.resolve(docsRoot, "topics", `${topic.slug}.md`);
  if (!(await exists(generatedPath))) {
    return false;
  }

  const content = await readFile(generatedPath, "utf8");
  const titleLine = content.match(/^title:\s*(.+)$/m);
  return titleLine?.[1]?.trim().startsWith('"') ?? false;
};

const renderHomePage = () => `---
layout: home
hero:
  name: Stell Forum
  text: Engineering Posts and Discussions
  tagline: A forum-style index of infrastructure, distributed systems, reliability, and platform engineering notes.
  actions:
    - theme: brand
      text: Browse Posts
      link: /topics/
    - theme: alt
      text: Discuss on GitHub
      link: https://github.com/stellhub/stell-web/discussions
---

<script setup>
import ForumPostIndex from "./.vitepress/theme/components/ForumPostIndex.vue";
import { data as topicPosts } from "./topics/posts.data.ts";
</script>

<div id="forum-latest">
  <ForumPostIndex :posts="topicPosts" />
</div>`;

const renderTopicsIndex = () => `---
layout: home
hero:
  name: Stell Forum
  text: Posts, Notes, and Discussions
  tagline: A forum-style index of engineering writing, centered on system boundaries, tradeoffs, and implementation decisions.
  actions:
    - theme: brand
      text: Browse Latest Posts
      link: "#forum-latest"
    - theme: alt
      text: Discuss on GitHub
      link: https://github.com/stellhub/stell-web/discussions
---

<script setup>
import ForumPostIndex from "../.vitepress/theme/components/ForumPostIndex.vue";
import { data as topicPosts } from "./posts.data.ts";
</script>

<div id="forum-latest">
  <ForumPostIndex :posts="topicPosts" />
</div>`;

const renderTopicPage = (topic, body, preferQuotedTitle) => {
  const tags = topic.tagsEn.map((tag) => `  - ${tag}`).join("\n");

return `---
title: ${renderYamlTitle(topic.titleEn, preferQuotedTitle)}
category: ${topic.categoryEn}
summary: ${topic.summaryEn}
tags:
${tags}
readingDirection: ${topic.readingDirectionEn}
outline: deep
---

# ${topic.titleEn}

## Overview

${topic.summaryEn}

${body}

## Chinese Reference

- [Read the original Chinese article](${zhTopicLink(topic.slug)})`;
};

const renderRootTopicData = () => `import { execFileSync } from "node:child_process";
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

const REPO_ROOT = path.resolve(__dirname, "../..");
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

export default createContentLoader("topics/*.md", {
  globOptions: {
    ignore: ["topics/index.md"]
  },
  transform(rawPosts) {
    return rawPosts
      .filter((post) => post.url !== "/topics/")
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
          category: post.frontmatter.category ?? "Uncategorized",
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

const renderZhTopicData = () => `import { execFileSync } from "node:child_process";
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

const REPO_ROOT = path.resolve(__dirname, "../../..");
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

export default createContentLoader("zh/topics/*.md", {
  globOptions: {
    ignore: ["zh/topics/index.md"]
  },
  transform(rawPosts) {
    return rawPosts
      .filter((post) => post.url !== "/zh/topics/")
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
          category: post.frontmatter.category ?? "未分类",
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

const bootstrapChineseDocs = async () => {
  if (await exists(zhRoot)) {
    return;
  }

  await mkdir(zhRoot, { recursive: true });
  await copyChineseSource(path.resolve(docsRoot), zhRoot);
};

const readTopicBody = async (topic) => {
  const sourcePath = path.resolve(topicDocRoot, `${topic.slug}.md`);
  if (await exists(sourcePath)) {
    return (await readFile(sourcePath, "utf8")).trim();
  }

  const generatedPath = path.resolve(docsRoot, "topics", `${topic.slug}.md`);
  if (await exists(generatedPath)) {
    return stripGeneratedTopicShell(await readFile(generatedPath, "utf8"));
  }

  throw new Error(`Missing topic content for ${topic.slug}`);
};

const shouldWriteTopicPage = async (topic) => {
  const sourcePath = path.resolve(topicDocRoot, `${topic.slug}.md`);
  const generatedPath = path.resolve(docsRoot, "topics", `${topic.slug}.md`);
  return (await exists(sourcePath)) || !(await exists(generatedPath));
};

const generateEnglishDocs = async () => {
  await writeDoc("index.md", renderHomePage());
  await writeDoc("topics/index.md", renderTopicsIndex());
  await writeDoc("topics/posts.data.ts", renderRootTopicData());

  for (const topic of topics) {
    if (!(await shouldWriteTopicPage(topic))) {
      continue;
    }

    const topicBody = await readTopicBody(topic);
    const preferQuotedTitle = await existingTopicTitleIsQuoted(topic);
    await writeDoc(`topics/${topic.slug}.md`, renderTopicPage(topic, topicBody, preferQuotedTitle));
  }
};

const generateChineseHelpers = async () => {
  await writeDoc("zh/topics/posts.data.ts", renderZhTopicData());
};

await bootstrapChineseDocs();
await generateEnglishDocs();
await generateChineseHelpers();
