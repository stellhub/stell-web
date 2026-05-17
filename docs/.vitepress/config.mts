import { defineConfig } from "vitepress";
import { topics } from "../../scripts/bilingual-metadata.mjs";

const buildPath = (base: string, value: string) => `${base}${value}`;
const buildHomeLink = (base: string) => (base ? `${base}/` : "/");

const buildPostMenu = (base: string, isZh: boolean) => [
  {
    text: isZh ? "论坛首页" : "Forum Home",
    link: buildPath(base, "/topics/")
  },
  ...topics.map((topic) => ({
    text: isZh ? topic.titleZh : topic.titleEn,
    link: buildPath(base, `/topics/${topic.slug}`)
  }))
];

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
