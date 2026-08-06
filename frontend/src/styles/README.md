# 前端样式拆分约定

- 全局入口：[`../index.css`](../index.css)（变量、布局、书库、阅读器、引用篮等）。
- AI 伴读：[`ai-reader.css`](./ai-reader.css)，在 [`../main.tsx`](../main.tsx) 中于 `index.css` **之后** 导入（Vite/PostCSS 不允许把 `@import` 插在样式文件中部）。
- 后续按域继续切分时：优先「独立文件 + main/入口显式 import」，并保持与原先在 `index.css` 中相近的先后顺序。
- 禁止在未跑 `npm run build` + 关键页目视回归前做大规模选择器重命名。
