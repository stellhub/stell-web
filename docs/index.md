---
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
</div>
