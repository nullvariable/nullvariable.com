import { readdir, stat, readFile } from 'fs/promises';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, extname, relative, basename } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';

const exec = promisify(execFile);

const BUCKET = 'nullvariable-com';
const ACCOUNT_ID = '20cf47b39d871fc8f4faeeb895520ddc';
const DIST = 'dist';
const MANIFEST_PATH = '.upload-manifest.json';
const FORCE = process.argv.includes('--force');

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

async function hashFileAsync(filePath) {
  const content = await readFile(filePath);
  return createHash('md5').update(content).digest('hex');
}

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
  // Blog HTML and unhashed assets get short cache
  if (filePath.includes('blog/') && !basename(filePath).match(/\.[a-f0-9]{8}\./)) {
    return 'public, max-age=3600';
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
  console.log(`${FORCE ? 'Force uploading' : 'Uploading'} to R2 bucket "${BUCKET}"...\n`);

  const manifest = loadManifest();
  const files = await walk(DIST);

  // Build a set of current file keys for cleanup
  const currentKeys = new Set();

  // Compute hashes and determine which files need uploading
  const toUpload = [];
  let skippedCount = 0;

  for (const file of files) {
    const key = relative(DIST, file);
    currentKeys.add(key);
    const hash = await hashFileAsync(file);

    if (!FORCE && manifest[key] && manifest[key] === hash) {
      skippedCount++;
      continue;
    }

    toUpload.push({ file, key, hash });
  }

  // Remove manifest entries for files that no longer exist in dist/
  for (const key of Object.keys(manifest)) {
    if (!currentKeys.has(key)) {
      delete manifest[key];
    }
  }

  if (toUpload.length === 0) {
    console.log(`  No changes detected. All ${skippedCount} files unchanged.`);
    saveManifest(manifest);
    console.log('\nDone — nothing to upload.');
    return;
  }

  console.log(`  ${toUpload.length} files to upload, ${skippedCount} unchanged.\n`);

  // Upload HTML files last so assets are available first
  const assets = toUpload.filter(f => extname(f.file) !== '.html');
  const html = toUpload.filter(f => extname(f.file) === '.html');

  for (const { file, key, hash } of [...assets, ...html]) {
    await upload(file);
    manifest[key] = hash;
  }

  // Save manifest after successful upload
  saveManifest(manifest);

  console.log(`\nDone — uploaded ${toUpload.length} files, skipped ${skippedCount} unchanged.`);
}

main().catch(err => {
  console.error('\nUpload failed.');
  process.exit(1);
});
