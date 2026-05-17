---
layout: home
hero:
  name: Stell 论坛
  text: 工程文章与讨论
  tagline: 围绕基础架构、分布式系统、可靠性与平台工程的论坛式知识库。
  actions:
    - theme: brand
      text: 浏览帖子
      link: /zh/topics/
    - theme: alt
      text: GitHub 讨论区
      link: https://github.com/stellhub/stell-web/discussions
---

<script setup>
import ForumPostIndex from "../.vitepress/theme/components/ForumPostIndex.vue";
import { data as topicPosts } from "./topics/posts.data.ts";
</script>

<div id="forum-latest">
  <ForumPostIndex :posts="topicPosts" />
</div>
