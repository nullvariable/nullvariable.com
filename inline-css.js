import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const DIST = 'dist';

function main() {
  let html = readFileSync(join(DIST, 'index.html'), 'utf8');

  // Find the CSS link — Parcel minifies away quotes: <link rel=stylesheet href=/file.css>
  const linkMatch = html.match(/<link\s+rel=stylesheet\s+href=([^\s>]+)>/i)
    || html.match(/<link\s+rel="stylesheet"\s+href="([^"]+)">/i);

  if (!linkMatch) {
    console.log('No stylesheet link found in dist/index.html, skipping inline.');
    return;
  }

  const cssPath = linkMatch[1].replace(/^\//, '');
  const cssContent = readFileSync(join(DIST, cssPath), 'utf8');

  html = html.replace(linkMatch[0], `<style>${cssContent}</style>`);
  writeFileSync(join(DIST, 'index.html'), html);

  console.log(`Inlined ${cssPath} into dist/index.html (${cssContent.length} bytes)`);
}

main();
