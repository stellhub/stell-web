<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useData, useRoute } from "vitepress";

const route = useRoute();
const { isDark, lang } = useData();

const container = ref<HTMLElement | null>(null);

const isTopicPost = computed(() => /^\/(?:zh\/)?topics\/[^/]+\/?$/.test(route.path));
const locale = computed(() => (lang.value.startsWith("zh") ? "zh-CN" : "en"));
const theme = computed(() => (isDark.value ? "dark" : "light"));

const clearComments = () => {
  if (container.value) {
    container.value.innerHTML = "";
  }
};

const renderGiscus = async () => {
  await nextTick();
  clearComments();

  if (!container.value || !isTopicPost.value || typeof document === "undefined") {
    return;
  }

  const script = document.createElement("script");
  script.src = "https://giscus.app/client.js";
  script.async = true;
  script.crossOrigin = "anonymous";
  script.setAttribute("data-repo", "stellhub/stell-web");
  script.setAttribute("data-repo-id", "R_kgDOR8S24Q");
  script.setAttribute("data-category", "General");
  script.setAttribute("data-category-id", "DIC_kwDOR8S24c4C9QU7");
  script.setAttribute("data-mapping", "pathname");
  script.setAttribute("data-strict", "0");
  script.setAttribute("data-reactions-enabled", "1");
  script.setAttribute("data-emit-metadata", "0");
  script.setAttribute("data-input-position", "bottom");
  script.setAttribute("data-theme", theme.value);
  script.setAttribute("data-lang", locale.value);
  script.setAttribute("data-loading", "lazy");

  container.value.appendChild(script);
};

onMounted(renderGiscus);

watch(
  () => route.path,
  () => {
    void renderGiscus();
  }
);

watch(theme, (value) => {
  if (typeof document === "undefined") {
    return;
  }

  const iframe = document.querySelector<HTMLIFrameElement>("iframe.giscus-frame");
  iframe?.contentWindow?.postMessage(
    {
      giscus: {
        setConfig: {
          theme: value
        }
      }
    },
    "https://giscus.app"
  );
});
</script>

<template>
  <section v-if="isTopicPost" class="giscus-comments" aria-label="GitHub Discussions comments">
    <div class="giscus-comments__head">
      <span class="giscus-comments__eyebrow">GitHub Discussions</span>
      <h2>{{ lang.startsWith("zh") ? "参与讨论" : "Join the discussion" }}</h2>
      <p>
        {{
          lang.startsWith("zh")
            ? "评论会同步到 stellhub/stell-web 仓库的 GitHub Discussions。"
            : "Comments are synchronized with GitHub Discussions in stellhub/stell-web."
        }}
      </p>
    </div>
    <div ref="container" class="giscus-comments__widget" />
  </section>
</template>
