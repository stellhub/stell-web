# Content Authoring Guide

`content/topics` is the source of truth for topic articles. The `docs/topics` and
`docs/zh/topics` directories are generated VitePress output.

## Topic Layout

Each topic lives in one directory:

```text
content/topics/<category>/<slug>/
  meta.json
  zh.md
  en.md
  assets/
```

- `meta.json` stores bilingual title, category, summary, tags, and reading direction.
- `zh.md` stores the Chinese article body.
- `en.md` stores the English article body.
- `assets/` is reserved for topic-local images or attachments.

The public routes remain flat and stable:

```text
/topics/<slug>
/zh/topics/<slug>
```

The category directory is only for source organization and sidebar grouping.

## Add a Topic

1. Create `content/topics/<category>/<slug>/`.
2. Add `meta.json`, `zh.md`, and `en.md`.
3. Run:

```bash
npm run docs:check
```

The command regenerates VitePress pages, validates topic structure, and runs the
production build.

## Validation Rules

`npm run docs:validate` checks that:

- every topic has `meta.json`, `zh.md`, and `en.md`;
- every topic has complete bilingual metadata;
- slugs are unique;
- the category directory matches `category.en`;
- generated English pages link back to the Chinese page.
