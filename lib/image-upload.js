// Writes an uploaded image into src/images, where Eleventy's passthrough copy
// already picks it up. A browser page can't write to disk, so this is the same
// arrangement as the link lookup: the dev server does what the page can't.

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_BYTES = 10 * 1024 * 1024;

// src/ is the source of truth and what gets committed. _site/ is written too
// because the passthrough copy only runs at build time, so without it the
// running preview 404s on an image until the next rebuild.
const IMAGE_DIRS = ['src/images/courses', '_site/images/courses'];

// Extension comes from the content type, never from the supplied filename.
const EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

// Enough of each signature to catch a mislabelled file — an HTML error page
// sent as image/png, say.
const SIGNATURES = {
  'image/png': body => body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/jpeg': body => body[0] === 0xff && body[1] === 0xd8,
  'image/gif': body => body.subarray(0, 3).toString('latin1') === 'GIF',
  'image/webp': body =>
    body.subarray(0, 4).toString('latin1') === 'RIFF' &&
    body.subarray(8, 12).toString('latin1') === 'WEBP',
  'image/svg+xml': body => /<svg[\s>]/i.test(body.subarray(0, 1024).toString('utf8')),
};

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        reject(Object.assign(new Error('That image is over 10MB.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function saveImage({ body, contentType, course }) {
  const extension = EXTENSIONS[contentType];
  if (!extension) {
    throw Object.assign(new Error('Only PNG, JPEG, WebP, GIF and SVG are accepted.'), { status: 415 });
  }
  if (!body.length) {
    throw Object.assign(new Error('That file was empty.'), { status: 400 });
  }
  if (!SIGNATURES[contentType]?.(body)) {
    throw Object.assign(new Error(`That file isn't really a ${extension.toUpperCase()}.`), { status: 415 });
  }

  // Content-addressed, so re-uploading the same picture reuses the same file
  // rather than filling the folder with near-duplicates.
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 12);
  const folder = slugify(course);
  const filename = `${hash}.${extension}`;

  for (const root of IMAGE_DIRS) {
    await mkdir(path.join(root, folder), { recursive: true });
    await writeFile(path.join(root, folder, filename), body);
  }

  // The path as the site serves it, which is what gets stored on the block.
  return { src: `/images/courses/${folder}/${filename}`, bytes: body.length };
}

export function imageUploadMiddleware(req, res, next) {
  const requestUrl = new URL(req.url, 'http://localhost');
  if (requestUrl.pathname !== '/api/upload-image') return next();

  const send = (status, payload) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(payload));
  };

  if (req.method !== 'POST') return send(405, { error: 'POST an image body here.' });

  readBody(req)
    .then(body => saveImage({
      body,
      contentType: (req.headers['content-type'] || '').split(';')[0].trim(),
      course: requestUrl.searchParams.get('course'),
    }))
    .then(result => send(200, result))
    .catch(error => send(error.status || 500, { error: error.message }));
}
