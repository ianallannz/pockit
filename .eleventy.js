// .eleventy.js
import markdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";
import { DateTime } from "luxon";
import slugify from "slugify";
import { linkMetaMiddleware } from "./lib/link-meta.js";
import { imageUploadMiddleware } from "./lib/image-upload.js";

function getByPath(obj, keyPath) {
  return keyPath.split(".").reduce((acc, k) => acc && acc[k], obj);
}

export default function(eleventyConfig) {
  const md = markdownIt({ html: true, linkify: true })
    .use(markdownItAnchor, { permalink: true, permalinkClass: "direct-link", permalinkSymbol: "#" });

  // Markdown filter
  eleventyConfig.addNunjucksFilter("markdown", value => md.render(String(value || "")));
  eleventyConfig.setLibrary("md", md);

  // Slug filter
  eleventyConfig.addFilter("slug", input => slugify(input, { lower: true, strict: true }));

  // Date filter
  eleventyConfig.addFilter("date", (dateObj, format = "dd LLLL yyyy") =>
    DateTime.fromJSDate(dateObj).toFormat(format)
  );

  // Build-time current year — for footer copyright lines etc. `page.date`
  // isn't right for this: it reflects a file's own creation/modified date,
  // not when the site was actually built, so it drifts stale for any page
  // that isn't edited every year.
  eleventyConfig.addGlobalData("currentYear", () => new Date().getFullYear());

// 1) Collection: all course handouts under src/courses
eleventyConfig.addCollection("courses", (collection) => {
  return collection.getFilteredByGlob("src/courses/**/*.md").map(item => {
    // Derive provider from the input path
    // e.g. src/courses/eit/l5-business-functions/materials/week-1/intro.md
    const parts = item.inputPath.split("/");
    // parts[2] = "courses", parts[3] = "eit", parts[4] = "l5-business-functions"
    item.data.provider = parts[3]; // "eit"
    return item;
  });
});

  // 2) Filter: where(arr, "data.course", "l5-business-functions")
  eleventyConfig.addFilter("where", (arr, keyPath, value) => {
    return (arr || []).filter(item => getByPath(item, keyPath) === value);
  });

  // 3) Filter: sortBy(arr, "data.handout")
  eleventyConfig.addFilter("sortBy", (arr, keyPath) => {
    return (arr || []).slice().sort((a, b) => {
      const av = getByPath(a, keyPath);
      const bv = getByPath(b, keyPath);
      if (typeof av === "number" && typeof bv === "number") return av - bv;
      return String(av).localeCompare(String(bv), undefined, { numeric: true });
    });
  });

  // 4) Filter: groupByWeek(arr) → [{ week, items }]
  eleventyConfig.addFilter("groupByWeek", (arr) => {
    const groups = new Map();
    for (const item of arr || []) {
      const wk = getByPath(item, "data.week");
      if (!groups.has(wk)) groups.set(wk, []);
      groups.get(wk).push(item);
    }
    return Array.from(groups.entries())
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([week, items]) => ({
        week: Number(week),
        items: items.slice().sort((a, b) => {
          const ah = getByPath(a, "data.handout");
          const bh = getByPath(b, "data.handout");
          return Number(ah) - Number(bh);
        })
      }));
  });

eleventyConfig.addFilter("groupByCourseWeek", (arr = []) => {
  const groups = new Map();
  for (const item of arr) {
    const { provider, course, week } = item.data;
    const key = `${provider}|${course}|${week}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return Array.from(groups.entries()).map(([key, items]) => {
    const [provider, course, weekStr] = key.split("|");
    return { provider, course, week: Number(weekStr), items };
  });
});

eleventyConfig.addCollection("courseWeeks", (collectionApi) => {
  const arr = collectionApi.getFilteredByGlob("src/courses/**/*.md");
  const groups = new Map();
  for (const item of arr) {
    // Derive provider from inputPath just like in courses
    const parts = item.inputPath.split("/");
    const provider = parts[3]; // "eit"
    const course = item.data.course;
    const week = item.data.week;
    const key = `${provider}|${course}|${week}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return Array.from(groups.entries()).map(([key, items]) => {
    const [provider, course, weekStr] = key.split("|");
    return { provider, course, week: Number(weekStr), items };
  });
});



eleventyConfig.addFilter("log", value => {
  console.log(value);
  return "";
});


  
  // Course builder link lookup — the browser can't read another origin, so
  // /api/link-meta does the fetching. Dev server only.
  eleventyConfig.setServerOptions({
    middleware: [linkMetaMiddleware, imageUploadMiddleware],
  });

  // Passthrough copies
  eleventyConfig.addPassthroughCopy({ "src/images": "images" });
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addPassthroughCopy({ "src/js": "js" });
  eleventyConfig.addPassthroughCopy({ "src/docs": "docs" });
  eleventyConfig.addPassthroughCopy({ "src/note": "note" });
  eleventyConfig.addPassthroughCopy({ "src/course-builder": "course-builder" });
  eleventyConfig.addPassthroughCopy({ "src/note-builder": "note-builder" });
  // card-format.js lives here so the same file can be imported by this Node
  // build (via a plain node_modules-resolved `import ... from 'js-yaml'`)
  // and, unmodified, by the browser composer (which resolves that same
  // specifier through its own import map — see src/course-builder/index.html).
  eleventyConfig.addPassthroughCopy({ "src/_lib": "_lib" });
  
  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      layouts: "_includes/layouts"
    },
    templateFormats: ["md", "njk", "html"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    dataTemplateEngine: "njk"
  };
}