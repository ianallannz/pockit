// ── card-format ──────────────────────────────────────────────
// Parses and serializes a card's markdown file: YAML front matter, then a
// sequence of `::: <type> h=<rows> [key=value ...]` fenced containers, one
// per content block, closed by a bare `:::` line. Body markdown lives
// between the fence lines.
//
// One shared module for both the browser (composer) and this Eleventy/Node
// build — see src/course-builder/index.html's import map, which is what
// lets the `js-yaml` specifier below resolve in the browser too.
//
// The container vocabulary is never hand-duplicated here: every block
// type's shape comes from its `format` entry in block-types.js (`body`
// names the prose field, `attrs` lists scalar fields; a type with
// non-scalar data — currently just Matrix — provides `toAttrs`/`fromAttrs`
// instead). Attributes this module doesn't recognize round-trip verbatim
// via `block._unknownAttrs`, so a newer format's fields survive being
// opened and re-saved by an older build.
import { load, dump } from 'js-yaml';
import { blockType } from '../course-builder/js/block-types.js';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const FENCE_OPEN_RE = /^:::\s+(\S+)(.*)$/;
const ATTR_RE = /(\w+)=(?:"((?:[^"\\]|\\.)*)"|(\S+))/g;

function parseAttrLine(attrLine) {
  const attrs = {};
  let match;
  ATTR_RE.lastIndex = 0;
  while ((match = ATTR_RE.exec(attrLine))) {
    const [, key, quoted, bare] = match;
    attrs[key] = quoted !== undefined ? quoted.replace(/\\"/g, '"') : bare;
  }
  return attrs;
}

// Attribute values are read as strings (that's all a fence line can hold);
// anything that looks like a plain integer/decimal is handed back as a
// number so fields like `entries`/`n`/`h` behave like the composer's own
// in-memory blocks rather than silently becoming strings.
function coerce(value) {
  return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
}

function buildBlockFromContainer(typeId, attrLine, bodyText) {
  const rawAttrs = parseAttrLine(attrLine);
  const h = rawAttrs.h !== undefined ? Number(rawAttrs.h) : undefined;
  delete rawAttrs.h;

  const type = blockType(typeId);
  const block = { type: typeId, h };

  if (!type) {
    // Unrecognized type (older content, or a newer format this build
    // doesn't know yet) — preserved whole rather than dropped.
    if (Object.keys(rawAttrs).length) block._unknownAttrs = rawAttrs;
    block.body = bodyText;
    return block;
  }

  const consumed = new Set();
  if (type.format.fromAttrs) {
    for (const key of type.format.fromAttrs(rawAttrs, block)) consumed.add(key);
  }
  for (const field of type.format.attrs || []) {
    if (rawAttrs[field] !== undefined) {
      block[field] = coerce(rawAttrs[field]);
      consumed.add(field);
    }
  }
  if (type.format.body) block[type.format.body] = bodyText;

  const unknown = {};
  for (const [key, value] of Object.entries(rawAttrs)) {
    if (!consumed.has(key)) unknown[key] = value;
  }
  if (Object.keys(unknown).length) block._unknownAttrs = unknown;

  return block;
}

function parseBlocks(bodyText) {
  const lines = bodyText.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const open = lines[i].match(FENCE_OPEN_RE);
    if (!open) { i++; continue; } // stray blank/whitespace between containers

    const [, typeId, attrLine] = open;
    i++;

    const bodyLines = [];
    while (i < lines.length && lines[i].trim() !== ':::') {
      bodyLines.push(lines[i]);
      i++;
    }
    i++; // past the closing fence (or past end, if the file was truncated)

    blocks.push(buildBlockFromContainer(typeId, attrLine, bodyLines.join('\n')));
  }

  return blocks;
}

export function parse(markdown) {
  const text = String(markdown).replace(/\r\n/g, '\n');
  const match = text.match(FRONTMATTER_RE);
  const frontmatter = match ? (load(match[1]) || {}) : {};
  const body = match ? match[2] : text;
  return { frontmatter, blocks: parseBlocks(body) };
}

function serializeAttrValue(value) {
  const str = String(value);
  return /[\s"]/.test(str) ? `"${str.replace(/"/g, '\\"')}"` : str;
}

function buildContainer(block) {
  const type = blockType(block.type);
  const h = block.h ?? type?.defaultRows ?? 1;

  if (!type) {
    const attrs = block._unknownAttrs || {};
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}=${serializeAttrValue(v)}`).join(' ');
    const fence = `::: ${block.type} h=${h}${attrStr ? ` ${attrStr}` : ''}`;
    const lines = [fence];
    if (block.body) lines.push(block.body);
    lines.push(':::');
    return lines.join('\n');
  }

  const pairs = type.format.toAttrs ? [...type.format.toAttrs(block)] : [];
  for (const field of type.format.attrs || []) {
    const value = block[field];
    if (value === undefined || value === null || value === '') continue;
    pairs.push([field, value]);
  }
  for (const [key, value] of Object.entries(block._unknownAttrs || {})) {
    pairs.push([key, value]);
  }

  const attrStr = pairs.map(([k, v]) => `${k}=${serializeAttrValue(v)}`).join(' ');
  const fence = `::: ${block.type} h=${h}${attrStr ? ` ${attrStr}` : ''}`;

  const bodyText = type.format.body ? (block[type.format.body] || '') : '';
  const lines = [fence];
  if (bodyText) lines.push(bodyText);
  lines.push(':::');
  return lines.join('\n');
}

export function serialize({ frontmatter, blocks }) {
  const fm = dump(frontmatter || {}, { lineWidth: -1 }).trimEnd();
  const containers = (blocks || []).map(buildContainer).join('\n\n');
  return `---\n${fm}\n---\n\n${containers}\n`;
}
