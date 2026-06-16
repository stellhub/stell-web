---
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
</div>
