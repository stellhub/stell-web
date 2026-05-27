import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const contentRoot = path.resolve(repoRoot, "content", "topics");
const docsRoot = path.resolve(repoRoot, "docs");

const exists = async (target) => {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
};

const categorySlug = (value) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const walkTopicDirs = async (dir) => {
  const result = [];
  if (!(await exists(dir))) {
    return result;
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const hasMeta = entries.some((entry) => entry.isFile() && entry.name === "meta.json");
  if (hasMeta) {
    result.push(dir);
    return result;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      result.push(...(await walkTopicDirs(path.join(dir, entry.name))));
    }
  }

  return result;
};

const readJson = async (target) => JSON.parse(await readFile(target, "utf8"));

const requireText = (errors, value, field, topicDir) => {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`Missing ${field} in ${topicDir}`);
  }
};

const requireList = (errors, value, field, topicDir) => {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    errors.push(`Missing ${field} in ${topicDir}`);
  }
};

const validate = async () => {
  const errors = [];
  const topicDirs = await walkTopicDirs(contentRoot);
  const seenSlugs = new Set();

  if (topicDirs.length === 0) {
    errors.push("No topics found under content/topics");
  }

  for (const topicDir of topicDirs) {
    const metaPath = path.join(topicDir, "meta.json");
    const meta = await readJson(metaPath);
    const slug = meta.slug;

    requireText(errors, slug, "slug", topicDir);
    requireText(errors, meta.title?.en, "title.en", topicDir);
    requireText(errors, meta.title?.zh, "title.zh", topicDir);
    requireText(errors, meta.category?.en, "category.en", topicDir);
    requireText(errors, meta.category?.zh, "category.zh", topicDir);
    requireText(errors, meta.summary?.en, "summary.en", topicDir);
    requireText(errors, meta.summary?.zh, "summary.zh", topicDir);
    requireText(errors, meta.readingDirection?.en, "readingDirection.en", topicDir);
    requireText(errors, meta.readingDirection?.zh, "readingDirection.zh", topicDir);
    requireList(errors, meta.tags?.en, "tags.en", topicDir);
    requireList(errors, meta.tags?.zh, "tags.zh", topicDir);

    if (typeof slug === "string") {
      if (seenSlugs.has(slug)) {
        errors.push(`Duplicate topic slug: ${slug}`);
      }
      seenSlugs.add(slug);

      const expectedCategoryDir = categorySlug(meta.category?.en ?? "");
      const actualCategoryDir = path.basename(path.dirname(topicDir));
      if (expectedCategoryDir && actualCategoryDir !== expectedCategoryDir) {
        errors.push(`Topic ${slug} is under ${actualCategoryDir}, expected ${expectedCategoryDir}`);
      }

      for (const fileName of ["zh.md", "en.md"]) {
        const sourcePath = path.join(topicDir, fileName);
        if (!(await exists(sourcePath))) {
          errors.push(`Missing ${fileName} for ${slug}`);
        }
      }

      const enPage = path.join(docsRoot, "topics", `${slug}.md`);
      const zhPage = path.join(docsRoot, "zh", "topics", `${slug}.md`);
      if (!(await exists(enPage))) {
        errors.push(`Missing generated English page for ${slug}`);
      } else {
        const content = await readFile(enPage, "utf8");
        if (!content.includes("## Chinese Reference") || !content.includes(`(/zh/topics/${slug})`)) {
          errors.push(`Generated English page for ${slug} is missing Chinese Reference`);
        }
      }

      if (!(await exists(zhPage))) {
        errors.push(`Missing generated Chinese page for ${slug}`);
      }
    }
  }

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
    return;
  }

  console.log(`Validated ${topicDirs.length} topics.`);
};

await validate();
