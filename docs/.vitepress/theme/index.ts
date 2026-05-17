import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import GiscusComments from "./components/GiscusComments.vue";
import "./style.css";

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "doc-after": () => h(GiscusComments)
    })
};
