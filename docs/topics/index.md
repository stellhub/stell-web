---
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
</div>
