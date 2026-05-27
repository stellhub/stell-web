import { defineConfig } from "vitepress";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const contentRoot = path.resolve(repoRoot, "content", "topics");

interface TopicMeta {
  slug: string;
  title: {
    en: string;
    zh: string;
  };
  category: {
    en: string;
    zh: string;
  };
}

const findTopicMetaFiles = (dir: string): string[] => {
  if (!existsSync(dir)) {
    return [];
  }

  const entries = readdirSync(dir, { withFileTypes: true });
  const hasMeta = entries.some((entry) => entry.isFile() && entry.name === "meta.json");
  if (hasMeta) {
    return [path.join(dir, "meta.json")];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => findTopicMetaFiles(path.join(dir, entry.name)));
};

const topics = findTopicMetaFiles(contentRoot)
  .map((file) => JSON.parse(readFileSync(file, "utf8")) as TopicMeta)
  .sort((left, right) => {
    const category = left.category.en.localeCompare(right.category.en);
    return category === 0 ? left.title.en.localeCompare(right.title.en) : category;
  });

const buildPath = (base: string, value: string) => `${base}${value}`;
const buildHomeLink = (base: string) => (base ? `${base}/` : "/");

const buildPostMenu = (base: string, isZh: boolean) => {
  const groups = new Map<string, TopicMeta[]>();

  for (const topic of topics) {
    const category = isZh ? topic.category.zh : topic.category.en;
    groups.set(category, [...(groups.get(category) ?? []), topic]);
  }

  return [
    {
      text: isZh ? "论坛首页" : "Forum Home",
      link: buildPath(base, "/topics/")
    },
    ...Array.from(groups.entries()).map(([category, items]) => ({
      text: category,
      collapsed: true,
      items: items.map((topic) => ({
        text: isZh ? topic.title.zh : topic.title.en,
        link: buildPath(base, `/topics/${topic.slug}`)
      }))
    }))
  ];
};

const buildLocaleTheme = (base: string, isZh: boolean) => {
  const homeLink = buildHomeLink(base);

  return {
    siteTitle: isZh ? "Stell 论坛" : "Stell Forum",
    logo: "/logo/logo.png",
    nav: [
      {
        text: isZh ? "首页" : "Home",
        link: homeLink
      },
      {
        text: isZh ? "帖子" : "Posts",
        link: buildPath(base, "/topics/")
      }
    ],
    sidebar: {
      [buildPath(base, "/topics/")]: [
        {
          text: isZh ? "论坛文章" : "Forum Posts",
          items: buildPostMenu(base, isZh)
        }
      ],
      [homeLink]: [
        {
          text: isZh ? "论坛导航" : "Forum",
          items: [
            {
              text: isZh ? "首页" : "Home",
              link: homeLink
            },
            {
              text: isZh ? "帖子" : "Posts",
              link: buildPath(base, "/topics/")
            }
          ]
        }
      ]
    },
    outline: {
      level: [2, 3],
      label: isZh ? "页面导航" : "On This Page"
    },
    search: {
      provider: "local"
    },
    socialLinks: [{ icon: "github", link: "https://github.com/stellhub/stell-web" }],
    docFooter: {
      prev: isZh ? "上一篇" : "Previous post",
      next: isZh ? "下一篇" : "Next post"
    },
    footer: {
      message: "Powered by VitePress and GitHub Discussions.",
      copyright: "Copyright © Stell Forum"
    },
    lastUpdated: {
      text: isZh ? "最后更新" : "Last updated"
    },
    darkModeSwitchLabel: isZh ? "主题切换" : "Appearance",
    lightModeSwitchTitle: isZh ? "切换到浅色模式" : "Switch to light theme",
    darkModeSwitchTitle: isZh ? "切换到深色模式" : "Switch to dark theme",
    sidebarMenuLabel: isZh ? "菜单" : "Menu",
    returnToTopLabel: isZh ? "返回顶部" : "Return to top"
  };
};

export default defineConfig({
  title: "Stell Forum",
  description:
    "A VitePress forum-style knowledge base for infrastructure, distributed systems, and engineering notes.",
  cleanUrls: true,
  lastUpdated: true,
  head: [["link", { rel: "icon", type: "image/png", href: "/logo/logo.png" }]],
  vite: {
    server: {
      allowedHosts: [".stellhub.top"]
    }
  },
  locales: {
    root: {
      label: "English",
      lang: "en-US",
      title: "Stell Forum",
      description:
        "Forum-style engineering notes on infrastructure, distributed systems, reliability, and platform design.",
      themeConfig: buildLocaleTheme("", false)
    },
    zh: {
      label: "简体中文",
      lang: "zh-CN",
      link: "/zh/",
      title: "Stell 论坛",
      description: "围绕基础架构、分布式系统、可靠性与平台工程的论坛式知识库。",
      themeConfig: buildLocaleTheme("/zh", true)
    }
  }
});
