import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, existsSync, cpSync } from 'fs';
import { join, basename, extname } from 'path';
import { createHash } from 'crypto';
import matter from 'gray-matter';
import { marked } from 'marked';

const SRC = 'src';
const DIST = 'dist';
const BLOG_SRC = 'src/blog';
const BLOG_DIST = 'dist/blog';
const SITE_URL = 'https://nullvariable.com';
const MANIFEST_PATH = '.blog-manifest.json';
const FORCE = process.argv.includes('--force');

// --- Manifest helpers ---

function loadManifest() {
  if (FORCE) return {};
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveManifest(manifest) {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

function hashFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  return createHash('md5').update(content).digest('hex');
}

// --- Include resolver (mimics PostHTML) ---

function resolveIncludes(html, root) {
  return html.replace(/<include\s+src="([^"]+)"[^>]*><\/include>/g, (match, srcPath) => {
    const resolved = join(root, srcPath);
    try {
      const content = readFileSync(resolved, 'utf8');
      return resolveIncludes(content, root);
    } catch {
      console.warn(`  Warning: could not resolve include ${srcPath}`);
      return '';
    }
  });
}

// --- Load shared components ---

function loadComponents() {
  const nav = resolveIncludes(readFileSync(join(SRC, 'components/nav.html'), 'utf8'), SRC);
  const footer = resolveIncludes(readFileSync(join(SRC, 'components/footer.html'), 'utf8'), SRC);

  // On blog pages, "Let's Talk" should link to home instead of opening modal
  const blogNav = nav.replace(
    /onclick="document\.getElementById\('contactModal'\)\.showModal\(\)"/,
    `onclick="window.location='/'"`,
  );

  return { nav: blogNav, footer };
}

// --- Find Parcel-hashed CSS filename ---

function findCssFile() {
  const files = readdirSync(DIST).filter(f => f.endsWith('.css') && !f.endsWith('.map'));
  if (files.length === 0) throw new Error('No CSS file found in dist/. Run parcel build first.');
  return files[0];
}

// --- Load and parse markdown posts ---

function loadPosts() {
  const postsDir = join(BLOG_SRC, 'posts');
  let files;
  try {
    files = readdirSync(postsDir).filter(f => f.endsWith('.md'));
  } catch {
    console.warn('  No posts found in src/blog/posts/');
    return [];
  }

  return files.map(file => {
    const raw = readFileSync(join(postsDir, file), 'utf8');
    const { data, content } = matter(raw);
    const html = marked(content);
    const slug = basename(file, '.md').replace(/^\d{4}-\d{2}-\d{2}-/, '');
    const date = data.date ? new Date(data.date) : new Date();
    const tags = data.tags || [];

    return {
      title: data.title || slug,
      date,
      dateStr: date.toISOString().split('T')[0],
      dateDisplay: date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      description: data.description || '',
      tags,
      slug,
      html,
      image: data.image || null,
      file,
    };
  }).sort((a, b) => b.date - a.date);
}

// --- Render tags HTML ---

function tagsHtml(tags) {
  if (!tags.length) return '';
  const pills = tags.map(t =>
    `<a class="tag-pill" href="/blog/tag/${encodeTag(t)}/">${t}</a>`
  ).join('');
  return `<div class="tag-list">${pills}</div>`;
}

function encodeTag(tag) {
  return tag.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// --- Build post pages ---

function buildPostPages(posts, template, nav, footer, cssFile, blogCssFile, manifest) {
  const templateHash = hashFile(join(BLOG_SRC, 'template.html'));
  const prevTemplateHash = manifest._templateHash;
  const templateChanged = templateHash !== prevTemplateHash;
  manifest._templateHash = templateHash;

  let builtCount = 0;
  let skippedCount = 0;

  for (const post of posts) {
    const postSrcPath = join(BLOG_SRC, 'posts', post.file);
    const postHash = hashFile(postSrcPath);
    const dir = join(BLOG_DIST, post.slug);
    const outputFile = join(dir, 'index.html');

    // Check if we can skip this post
    const cached = manifest[post.file];
    if (!FORCE && cached && cached.hash === postHash && !templateChanged && existsSync(outputFile)) {
      console.log(`  Post: /blog/${post.slug}/ (cached)`);
      skippedCount++;
      continue;
    }

    mkdirSync(dir, { recursive: true });

    const imageHtml = post.image
      ? `<img class="blog-hero-image" src="/blog/images/${post.image}" alt="${post.title}" />`
      : '';

    const html = template
      .replace(/\{\{NAV\}\}/g, nav)
      .replace(/\{\{FOOTER\}\}/g, footer)
      .replace(/\{\{CSS_FILE\}\}/g, cssFile)
      .replace(/\{\{BLOG_CSS_FILE\}\}/g, blogCssFile)
      .replace(/\{\{TITLE\}\}/g, post.title)
      .replace(/\{\{DESCRIPTION\}\}/g, post.description.replace(/"/g, '&quot;'))
      .replace(/\{\{SLUG\}\}/g, post.slug)
      .replace(/\{\{DATE\}\}/g, post.dateStr)
      .replace(/\{\{DATE_DISPLAY\}\}/g, post.dateDisplay)
      .replace(/\{\{TAGS_HTML\}\}/g, tagsHtml(post.tags))
      .replace(/\{\{IMAGE\}\}/g, imageHtml)
      .replace(/\{\{CONTENT\}\}/g, post.html);

    writeFileSync(outputFile, html);
    manifest[post.file] = { hash: postHash };
    builtCount++;
    console.log(`  Post: /blog/${post.slug}/`);
  }

  return { builtCount, skippedCount };
}

// --- Build index page ---

function buildIndexPage(posts, template, nav, footer, cssFile, blogCssFile) {
  const postsHtml = posts.map(post => `
    <div class="post-card">
      <time datetime="${post.dateStr}">${post.dateDisplay}</time>
      <h2><a href="/blog/${post.slug}/">${post.title}</a></h2>
      <p>${post.description}</p>
      ${tagsHtml(post.tags)}
    </div>
  `).join('');

  const html = template
    .replace(/\{\{NAV\}\}/g, nav)
    .replace(/\{\{FOOTER\}\}/g, footer)
    .replace(/\{\{CSS_FILE\}\}/g, cssFile)
    .replace(/\{\{BLOG_CSS_FILE\}\}/g, blogCssFile)
    .replace(/\{\{POSTS\}\}/g, postsHtml);

  mkdirSync(BLOG_DIST, { recursive: true });
  writeFileSync(join(BLOG_DIST, 'index.html'), html);
  console.log(`  Index: /blog/`);
}

// --- Build tag pages ---

function buildTagPages(posts, template, nav, footer, cssFile, blogCssFile) {
  const tagMap = {};
  for (const post of posts) {
    for (const tag of post.tags) {
      const key = encodeTag(tag);
      if (!tagMap[key]) tagMap[key] = { name: tag, posts: [] };
      tagMap[key].posts.push(post);
    }
  }

  for (const [key, { name, posts: tagPosts }] of Object.entries(tagMap)) {
    const dir = join(BLOG_DIST, 'tag', key);
    mkdirSync(dir, { recursive: true });

    const postsHtml = tagPosts.map(post => `
      <div class="post-card">
        <time datetime="${post.dateStr}">${post.dateDisplay}</time>
        <h2><a href="/blog/${post.slug}/">${post.title}</a></h2>
        <p>${post.description}</p>
        ${tagsHtml(post.tags)}
      </div>
    `).join('');

    const html = template
      .replace(/\{\{NAV\}\}/g, nav)
      .replace(/\{\{FOOTER\}\}/g, footer)
      .replace(/\{\{CSS_FILE\}\}/g, cssFile)
      .replace(/\{\{BLOG_CSS_FILE\}\}/g, blogCssFile)
      .replace(/\{\{TAG\}\}/g, name)
      .replace(/\{\{POSTS\}\}/g, postsHtml);

    writeFileSync(join(dir, 'index.html'), html);
    console.log(`  Tag: /blog/tag/${key}/`);
  }
}

// --- Build RSS feed ---

function buildRssFeed(posts) {
  const items = posts.slice(0, 20).map(post => `
    <item>
      <title><![CDATA[${post.title}]]></title>
      <link>${SITE_URL}/blog/${post.slug}/</link>
      <guid>${SITE_URL}/blog/${post.slug}/</guid>
      <pubDate>${post.date.toUTCString()}</pubDate>
      <description><![CDATA[${post.description}]]></description>
    </item>`).join('');

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Nullvariable Blog</title>
    <link>${SITE_URL}/blog/</link>
    <description>Thoughts on AI, performance, e-commerce, and building things for the web.</description>
    <language>en-us</language>
    <atom:link href="${SITE_URL}/blog/feed.xml" rel="self" type="application/rss+xml" />
    ${items}
  </channel>
</rss>`;

  writeFileSync(join(BLOG_DIST, 'feed.xml'), feed);
  console.log(`  RSS: /blog/feed.xml`);
}

// --- Process blog CSS (minify + hash) ---

function processBlogCss() {
  let css = readFileSync(join(BLOG_SRC, 'blog.css'), 'utf8');
  // Simple minification: strip comments, collapse whitespace
  css = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
  const hash = createHash('md5').update(css).digest('hex').slice(0, 8);
  const filename = `blog.${hash}.css`;
  writeFileSync(join(BLOG_DIST, filename), css);
  return filename;
}

// --- Copy images incrementally ---

function copyImages() {
  const imagesDir = join(BLOG_SRC, 'images');
  if (!existsSync(imagesDir)) return;

  const imagesDist = join(BLOG_DIST, 'images');
  mkdirSync(imagesDist, { recursive: true });

  const files = readdirSync(imagesDir);
  let copiedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    const srcPath = join(imagesDir, file);
    const destPath = join(imagesDist, file);
    if (!FORCE && existsSync(destPath)) {
      const srcHash = createHash('md5').update(readFileSync(srcPath)).digest('hex');
      const destHash = createHash('md5').update(readFileSync(destPath)).digest('hex');
      if (srcHash === destHash) {
        skippedCount++;
        continue;
      }
    }
    copyFileSync(srcPath, destPath);
    copiedCount++;
  }

  const total = files.length;
  if (skippedCount > 0) {
    console.log(`  Images: ${copiedCount} copied, ${skippedCount} already exist (${total} total)`);
  } else {
    console.log(`  Images: ${total} files copied`);
  }
}

// --- Main ---

function main() {
  console.log(`Building blog...${FORCE ? ' (--force)' : ''}\n`);

  const manifest = loadManifest();
  const { nav, footer } = loadComponents();
  const cssFile = findCssFile();
  const posts = loadPosts();

  if (posts.length === 0) {
    console.log('No posts to build.');
    // Still copy CSS and create empty index
  }

  const postTemplate = readFileSync(join(BLOG_SRC, 'template.html'), 'utf8');
  const indexTemplate = readFileSync(join(BLOG_SRC, 'index-template.html'), 'utf8');
  const tagTemplate = readFileSync(join(BLOG_SRC, 'tag-template.html'), 'utf8');

  mkdirSync(BLOG_DIST, { recursive: true });

  // Minify + hash blog CSS first so we have the filename
  const blogCssFile = processBlogCss();
  console.log(`  CSS: /blog/${blogCssFile}`);

  const { builtCount, skippedCount } = buildPostPages(posts, postTemplate, nav, footer, cssFile, blogCssFile, manifest);

  // Always rebuild index, tags, and RSS (a new post affects all of these)
  buildIndexPage(posts, indexTemplate, nav, footer, cssFile, blogCssFile);
  buildTagPages(posts, tagTemplate, nav, footer, cssFile, blogCssFile);
  buildRssFeed(posts);

  // Copy images incrementally
  copyImages();

  // Save updated manifest
  saveManifest(manifest);

  const summary = skippedCount > 0
    ? `\nDone — ${builtCount} posts built, ${skippedCount} cached, ${posts.length} total.`
    : `\nDone — ${posts.length} posts built.`;
  console.log(summary);
}

main();
