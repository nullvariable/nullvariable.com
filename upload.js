import { readdir, stat } from 'fs/promises';
import { join, extname, relative } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execFile);

const BUCKET = 'nullvariable-com';
const ACCOUNT_ID = '20cf47b39d871fc8f4faeeb895520ddc';
const DIST = 'dist';

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain',
  '.map': 'application/json',
};

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

function cacheControl(filePath) {
  const ext = extname(filePath);
  if (ext === '.html' || filePath.endsWith('site.webmanifest')) {
    return 'no-cache';
  }
  return 'public, max-age=31536000, immutable';
}

function contentType(filePath) {
  return MIME_TYPES[extname(filePath)] || 'application/octet-stream';
}

async function upload(filePath) {
  const key = relative(DIST, filePath);
  const args = [
    'wrangler', 'r2', 'object', 'put',
    `${BUCKET}/${key}`,
    '--remote',
    '--file', filePath,
    '--content-type', contentType(filePath),
    '--cache-control', cacheControl(filePath),
  ];

  try {
    const { stdout, stderr } = await exec('npx', args);
    console.log(`  ✓ ${key}`);
  } catch (err) {
    console.error(`  ✗ ${key}: ${err.stderr || err.message}`);
    throw err;
  }
}

async function main() {
  const files = await walk(DIST);
  console.log(`Uploading ${files.length} files to R2 bucket "${BUCKET}"...\n`);

  // Upload HTML files last so assets are available first
  const assets = files.filter(f => extname(f) !== '.html');
  const html = files.filter(f => extname(f) === '.html');

  for (const file of [...assets, ...html]) {
    await upload(file);
  }

  console.log(`\nDone — ${files.length} files uploaded.`);
}

main().catch(err => {
  console.error('\nUpload failed.');
  process.exit(1);
});
