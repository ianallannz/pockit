// Fetches a URL and pulls out the title and description a social-share card
// would show. This has to run server-side: a browser is not allowed to read a
// response from another origin, so the course builder calls this instead.

const TIMEOUT_MS = 8000;

// Metadata lives in <head>, so reading stops there — but "there" can be a long
// way in. YouTube puts <title> about 687KB down, behind a wall of inline JS,
// with </head> at ~695KB. A smaller cap silently returns nothing for it.
const MAX_BYTES = 2 * 1024 * 1024;

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ',
};

function decodeEntities(text) {
  return text
    .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (_, name) => ENTITIES[name])
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

// Meta tags vary in attribute order, so match on the whole tag and then read
// the content out of it.
function metaContent(html, names) {
  for (const name of names) {
    const tag = new RegExp(
      `<meta[^>]+(?:property|name)\\s*=\\s*["']${name}["'][^>]*>`, 'i'
    ).exec(html);
    if (!tag) continue;

    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag[0]);
    if (content?.[1]?.trim()) return decodeEntities(content[1].trim());
  }
  return '';
}

function documentTitle(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? decodeEntities(match[1].replace(/\s+/g, ' ').trim()) : '';
}

// Reads at most MAX_BYTES so a huge page can't stall the dev server.
async function readCapped(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';

  const decoder = new TextDecoder();
  let html = '';
  let bytes = 0;

  while (bytes < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;

    const chunk = decoder.decode(value, { stream: true });
    html += chunk;

    // Everything worth having is in the head. Only the join between chunks is
    // rescanned, so this doesn't become quadratic on a very long head.
    if (/<\/head>/i.test(html.slice(-(chunk.length + 16)))) break;
  }

  await reader.cancel().catch(() => {});
  return html;
}

export async function fetchLinkMeta(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error('That is not a valid URL.'), { status: 400 });
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw Object.assign(new Error('Only http and https links can be fetched.'), { status: 400 });
  }

  let response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        // Some sites serve no metadata to an unrecognised agent.
        'user-agent': 'Mozilla/5.0 (compatible; PockitCourseBuilder/1.0)',
        accept: 'text/html,application/xhtml+xml',
      },
    });
  } catch (error) {
    const reason = error.name === 'TimeoutError' ? 'timed out' : 'could not be reached';
    throw Object.assign(new Error(`That link ${reason}.`), { status: 502 });
  }

  if (!response.ok) {
    throw Object.assign(new Error(`That link returned ${response.status}.`), { status: 502 });
  }

  // No point streaming a PDF or a video looking for meta tags.
  const contentType = response.headers.get('content-type') || '';
  if (contentType && !/html|xml/i.test(contentType)) {
    await response.body?.cancel().catch(() => {});
    return { url: response.url || url.href, title: '', description: '' };
  }

  const html = await readCapped(response);

  return {
    url: response.url || url.href,
    title: metaContent(html, ['og:title', 'twitter:title']) || documentTitle(html),
    description: metaContent(html, ['og:description', 'twitter:description', 'description']),
  };
}

// Connect-style middleware for the Eleventy dev server.
export function linkMetaMiddleware(req, res, next) {
  const requestUrl = new URL(req.url, 'http://localhost');
  if (requestUrl.pathname !== '/api/link-meta') return next();

  const send = (status, body) => {
    res.statusCode = status;
    // Deliberately no CORS headers: another site can still cause a fetch, but
    // cannot read what comes back, so this can't be used as an open proxy.
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  };

  fetchLinkMeta(requestUrl.searchParams.get('url') || '')
    .then(meta => send(200, meta))
    .catch(error => send(error.status || 500, { error: error.message }));
}
