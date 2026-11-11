/**
 * Unit tests for lib/image-source.mjs.
 *
 * Contract: docs/CONTRACT.md section 1.
 *
 * These tests never touch the real network or real DNS: every URL test injects
 * `fetchImpl` and `lookupImpl`. Temporary files are created under os.tmpdir()
 * and removed afterwards.
 */

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ImageSourceError,
  resolveImageSources,
  sniffImageMediaType,
} from '../lib/image-source.mjs';

const FIXTURE_PATH = fileURLToPath(
  new URL('./fixtures/tiny.png', import.meta.url),
);

/** 1x1 transparent PNG (same bytes as test/fixtures/tiny.png). */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const GIF_BYTES = Buffer.concat([
  Buffer.from('GIF89a'),
  Buffer.from([0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00]),
]);
const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 '),
]);

const PUBLIC_ADDRESS = { address: '93.184.216.34', family: 4 };

/** @type {Set<string>} Every temp dir created by the tests, for global cleanup. */
const createdTempDirs = new Set();

/** Create a temp dir under os.tmpdir() and track it for cleanup. */
async function makeTempDir(prefix = 'dsh-codex-vision-test-') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  createdTempDirs.add(dir);
  return dir;
}

/** Write a file into a temp dir and return its absolute path. */
async function writeFile(dir, name, bytes) {
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, bytes);
  return filePath;
}

/** Contract-shaped default options; individual tests override what they need. */
function baseOptions(overrides = {}) {
  return {
    cwd: process.cwd(),
    maxImages: 4,
    maxBytes: 1024 * 1024,
    allowUrls: false,
    allowDataUrls: false,
    allowPrivateUrls: false,
    ...overrides,
  };
}

/** Build a `data:` URL for the given media type and bytes. */
function dataUrl(mediaType, bytes) {
  return `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`;
}

/** Await a promise expected to reject with an ImageSourceError of `code`. */
async function expectImageSourceError(promise, code) {
  let error;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, `expected a rejection with code ${code}, but the promise resolved`);
  assert.ok(
    error instanceof ImageSourceError,
    `expected ImageSourceError, got ${error?.constructor?.name}: ${error?.message}`,
  );
  assert.equal(error.name, 'ImageSourceError');
  assert.equal(error.code, code);
  assert.equal(typeof error.message, 'string');
  assert.ok(error.message.length > 0, 'error message must not be empty');
  return error;
}

/**
 * Build an injected DNS lookup that records calls.
 * `handler(hostname)` returns an array of records or throws.
 */
function createLookup(handler) {
  const calls = [];
  const impl = async (hostname) => {
    calls.push(hostname);
    return handler(hostname);
  };
  return { impl, calls };
}

/** Build an injected fetch that records calls and serves queued responses. */
function createFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (typeof next === 'function') return next(url, init);
    if (next === undefined) throw new Error('unexpected extra fetch call');
    return next;
  };
  return { impl, calls };
}

/** A fetch implementation that never resolves until its abort signal fires. */
function hangingFetch() {
  return async (url, init) => {
    return new Promise((resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      signal?.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      });
    });
  };
}

after(async () => {
  for (const dir of createdTempDirs) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// sniffImageMediaType
// ---------------------------------------------------------------------------

test('sniffImageMediaType detects PNG/JPEG/GIF/WebP magic bytes', () => {
  assert.equal(sniffImageMediaType(PNG_BYTES), 'image/png');
  assert.equal(sniffImageMediaType(JPEG_BYTES), 'image/jpeg');
  assert.equal(sniffImageMediaType(GIF_BYTES), 'image/gif');
  assert.equal(sniffImageMediaType(WEBP_BYTES), 'image/webp');
});

test('sniffImageMediaType handles GIF87a', () => {
  const gif87a = Buffer.concat([
    Buffer.from('GIF87a'),
    Buffer.from([0x01, 0x00, 0x01, 0x00]),
  ]);
  assert.equal(sniffImageMediaType(gif87a), 'image/gif');
});

test('sniffImageMediaType ignores the file extension and rejects non-images', () => {
  assert.equal(sniffImageMediaType(Buffer.from('hello world, not an image')), undefined);
  assert.equal(sniffImageMediaType(Buffer.alloc(0)), undefined);
  // Truncated PNG magic: fewer than 8 bytes.
  assert.equal(sniffImageMediaType(Buffer.from([0x89, 0x50, 0x4e, 0x47])), undefined);
  // RIFF container that is not WebP.
  const riffWave = Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('WAVE'),
  ]);
  assert.equal(sniffImageMediaType(riffWave), undefined);
});

// ---------------------------------------------------------------------------
// Local files
// ---------------------------------------------------------------------------

test('resolves a relative local path against options.cwd without copying it', async () => {
  const dir = await makeTempDir();
  const filePath = await writeFile(dir, 'pic.png', PNG_BYTES);

  const result = await resolveImageSources(
    ['pic.png'],
    baseOptions({ cwd: dir }),
  );

  assert.equal(result.images.length, 1);
  const image = result.images[0];
  assert.equal(image.source, 'pic.png');
  assert.equal(image.kind, 'file');
  assert.equal(image.path, filePath);
  assert.equal(image.mediaType, 'image/png');
  assert.equal(image.bytes, PNG_BYTES.length);
  assert.equal(image.temporary, false);

  await result.cleanup();
  await result.cleanup(); // idempotent no-op when nothing was materialised
  assert.ok((await fs.stat(filePath)).isFile(), 'local file must be left untouched');
});

test('resolves an absolute local path', async () => {
  const dir = await makeTempDir();
  const filePath = await writeFile(dir, 'absolute.png', PNG_BYTES);

  const result = await resolveImageSources([filePath], baseOptions());
  assert.equal(result.images[0].path, filePath);
  assert.equal(result.images[0].kind, 'file');
  await result.cleanup();
});

test('resolves a file:// URL to the local file', async () => {
  const dir = await makeTempDir();
  const filePath = await writeFile(dir, 'via-file-url.png', PNG_BYTES);
  const fileUrl = pathToFileURL(filePath).href;

  const result = await resolveImageSources([fileUrl], baseOptions());
  const image = result.images[0];
  assert.equal(image.kind, 'file');
  assert.equal(image.path, filePath);
  assert.equal(image.temporary, false);
  assert.equal(image.mediaType, 'image/png');
  await result.cleanup();
});

const FORMAT_CASES = [
  ['PNG', PNG_BYTES, 'image/png'],
  ['JPEG', JPEG_BYTES, 'image/jpeg'],
  ['GIF', GIF_BYTES, 'image/gif'],
  ['WebP', WEBP_BYTES, 'image/webp'],
];

for (const [name, bytes, mediaType] of FORMAT_CASES) {
  test(`sniffs and accepts a local ${name} file (extension is irrelevant)`, async () => {
    const dir = await makeTempDir();
    // Deliberately misleading extension: detection is by magic bytes only.
    const filePath = await writeFile(dir, 'image.bin', bytes);

    const result = await resolveImageSources([filePath], baseOptions());
    assert.equal(result.images[0].mediaType, mediaType);
    assert.equal(result.images[0].bytes, bytes.length);
    await result.cleanup();
  });
}

test('local sources never create a temporary directory', async () => {
  const tempRoot = await makeTempDir();
  const dir = await makeTempDir();
  const filePath = await writeFile(dir, 'pic.png', PNG_BYTES);

  const result = await resolveImageSources(
    [filePath],
    baseOptions({ tempDir: tempRoot }),
  );
  assert.deepEqual(await fs.readdir(tempRoot), []);
  await result.cleanup();
});

test('rejects a missing local file with NOT_FOUND and exposes error.source', async () => {
  const dir = await makeTempDir();
  const error = await expectImageSourceError(
    resolveImageSources(['does-not-exist.png'], baseOptions({ cwd: dir })),
    'NOT_FOUND',
  );
  assert.equal(error.source, 'does-not-exist.png');
  assert.match(error.message, /does-not-exist\.png/);
});

test('rejects a directory with NOT_A_FILE', async () => {
  const dir = await makeTempDir();
  await expectImageSourceError(
    resolveImageSources([dir], baseOptions()),
    'NOT_A_FILE',
  );
});

test('rejects an empty local file with EMPTY_IMAGE', async () => {
  const dir = await makeTempDir();
  const filePath = await writeFile(dir, 'empty.png', Buffer.alloc(0));
  await expectImageSourceError(
    resolveImageSources([filePath], baseOptions()),
    'EMPTY_IMAGE',
  );
});

test('rejects an oversized local file with TOO_LARGE (message has sizes)', async () => {
  const dir = await makeTempDir();
  const tooBig = Buffer.concat([PNG_BYTES, Buffer.alloc(20)]);
  const filePath = await writeFile(dir, 'big.png', tooBig);

  const error = await expectImageSourceError(
    resolveImageSources([filePath], baseOptions({ maxBytes: PNG_BYTES.length })),
    'TOO_LARGE',
  );
  assert.match(error.message, new RegExp(String(tooBig.length)));
  assert.match(error.message, new RegExp(String(PNG_BYTES.length)));
});

test('accepts a local file whose size equals maxBytes exactly', async () => {
  const dir = await makeTempDir();
  const filePath = await writeFile(dir, 'exact.png', PNG_BYTES);

  const result = await resolveImageSources(
    [filePath],
    baseOptions({ maxBytes: PNG_BYTES.length }),
  );
  assert.equal(result.images[0].bytes, PNG_BYTES.length);
  await result.cleanup();
});

test('rejects a non-image local file with UNSUPPORTED_IMAGE', async () => {
  const dir = await makeTempDir();
  const filePath = await writeFile(dir, 'notes.png', Buffer.from('plain text'));
  await expectImageSourceError(
    resolveImageSources([filePath], baseOptions()),
    'UNSUPPORTED_IMAGE',
  );
});

// ---------------------------------------------------------------------------
// data: URLs
// ---------------------------------------------------------------------------

test('resolves a base64 data URL into a temporary PNG and cleans it up idempotently', async () => {
  const tempRoot = await makeTempDir();

  const result = await resolveImageSources(
    [dataUrl('image/png', PNG_BYTES)],
    baseOptions({ allowDataUrls: true, tempDir: tempRoot }),
  );

  assert.equal(result.images.length, 1);
  const image = result.images[0];
  assert.equal(image.kind, 'data');
  assert.equal(image.mediaType, 'image/png');
  assert.equal(image.bytes, PNG_BYTES.length);
  assert.equal(image.temporary, true);
  assert.ok(image.path.startsWith(`${tempRoot}${path.sep}`), 'temp file must live under tempDir');
  assert.match(image.path, /\.png$/);
  assert.deepEqual(await fs.readFile(image.path), PNG_BYTES);

  const tempDir = path.dirname(image.path);
  assert.ok((await fs.stat(tempDir)).isDirectory());

  // Concurrent + repeated cleanup must be safe and must remove the directory.
  await Promise.all([result.cleanup(), result.cleanup()]);
  await assert.rejects(fs.stat(tempDir), { code: 'ENOENT' });
  await result.cleanup();
});

test('data URL media type and base64 marker are case-insensitive', async () => {
  const tempRoot = await makeTempDir();
  const upper = `DATA:IMAGE/PNG;BASE64,${PNG_BYTES.toString('base64')}`;

  const result = await resolveImageSources(
    [upper],
    baseOptions({ allowDataUrls: true, tempDir: tempRoot }),
  );
  assert.equal(result.images[0].mediaType, 'image/png');
  assert.deepEqual(await fs.readFile(result.images[0].path), PNG_BYTES);
  await result.cleanup();
});

test('data URL extensions match the declared media type', async () => {
  const tempRoot = await makeTempDir();
  const result = await resolveImageSources(
    [dataUrl('image/jpeg', JPEG_BYTES), dataUrl('image/gif', GIF_BYTES)],
    baseOptions({ allowDataUrls: true, tempDir: tempRoot }),
  );
  assert.match(result.images[0].path, /\.jpg$/);
  assert.equal(result.images[0].mediaType, 'image/jpeg');
  assert.match(result.images[1].path, /\.gif$/);
  assert.equal(result.images[1].mediaType, 'image/gif');
  // Both files share the single per-call temp directory.
  assert.equal(path.dirname(result.images[0].path), path.dirname(result.images[1].path));
  await result.cleanup();
});

test('data URLs are forbidden when allowDataUrls is false', async () => {
  const error = await expectImageSourceError(
    resolveImageSources(
      [dataUrl('image/png', PNG_BYTES)],
      baseOptions({ allowDataUrls: false }),
    ),
    'URL_FORBIDDEN',
  );
  assert.match(error.message, /allowDataUrls/);
});

test('data URLs are forbidden by default (allowDataUrls undefined = fail closed)', async () => {
  await expectImageSourceError(
    resolveImageSources([dataUrl('image/png', PNG_BYTES)], {
      cwd: process.cwd(),
      maxImages: 4,
      maxBytes: 1024,
    }),
    'URL_FORBIDDEN',
  );
});

test('rejects unsupported data URL media types with UNSUPPORTED_IMAGE', async () => {
  const tempRoot = await makeTempDir();
  for (const url of [
    'data:image/svg+xml;base64,PHN2Zy8+',
    'data:text/plain;base64,aGVsbG8=',
    'data:application/octet-stream;base64,AAAA',
    'data:image/png,not-base64-marker',
  ]) {
    await expectImageSourceError(
      resolveImageSources([url], baseOptions({ allowDataUrls: true, tempDir: tempRoot })),
      'UNSUPPORTED_IMAGE',
    );
  }
});

test('rejects invalid base64 data URL payloads with INVALID_ARGUMENT', async () => {
  const tempRoot = await makeTempDir();
  for (const url of [
    'data:image/png;base64,!!!not-base64!!!',
    'data:image/png;base64,AAAA====',
    'data:image/png;base64,A',
  ]) {
    await expectImageSourceError(
      resolveImageSources([url], baseOptions({ allowDataUrls: true, tempDir: tempRoot })),
      'INVALID_ARGUMENT',
    );
  }
});

test('rejects a data URL that decodes to zero bytes with EMPTY_IMAGE', async () => {
  const tempRoot = await makeTempDir();
  await expectImageSourceError(
    resolveImageSources(
      ['data:image/png;base64,'],
      baseOptions({ allowDataUrls: true, tempDir: tempRoot }),
    ),
    'EMPTY_IMAGE',
  );
});

test('rejects an oversized data URL with TOO_LARGE (message has sizes)', async () => {
  const tempRoot = await makeTempDir();
  const error = await expectImageSourceError(
    resolveImageSources(
      [dataUrl('image/png', PNG_BYTES)],
      baseOptions({ allowDataUrls: true, tempDir: tempRoot, maxBytes: 10 }),
    ),
    'TOO_LARGE',
  );
  assert.match(error.message, new RegExp(String(PNG_BYTES.length)));
  assert.match(error.message, /10/);
});

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

test('rejects non-array, empty, non-string and blank sources with INVALID_ARGUMENT', async () => {
  await expectImageSourceError(
    resolveImageSources('pic.png', baseOptions()),
    'INVALID_ARGUMENT',
  );
  await expectImageSourceError(
    resolveImageSources([], baseOptions()),
    'INVALID_ARGUMENT',
  );
  await expectImageSourceError(
    resolveImageSources([42], baseOptions()),
    'INVALID_ARGUMENT',
  );
  await expectImageSourceError(
    resolveImageSources([{ path: 'x.png' }], baseOptions()),
    'INVALID_ARGUMENT',
  );
  await expectImageSourceError(
    resolveImageSources(['   '], baseOptions()),
    'INVALID_ARGUMENT',
  );
});

test('rejects too many sources with TOO_MANY_IMAGES before touching the filesystem', async () => {
  const error = await expectImageSourceError(
    resolveImageSources(
      ['missing-a.png', 'missing-b.png', 'missing-c.png'],
      baseOptions({ maxImages: 2 }),
    ),
    'TOO_MANY_IMAGES',
  );
  assert.match(error.message, /2/);
});

test('resolves a mixed list in input order', async () => {
  const tempRoot = await makeTempDir();
  const dir = await makeTempDir();
  const filePath = await writeFile(dir, 'one.png', PNG_BYTES);

  const result = await resolveImageSources(
    [filePath, dataUrl('image/png', PNG_BYTES)],
    baseOptions({ allowDataUrls: true, tempDir: tempRoot }),
  );

  assert.equal(result.images.length, 2);
  assert.equal(result.images[0].kind, 'file');
  assert.equal(result.images[0].temporary, false);
  assert.equal(result.images[1].kind, 'data');
  assert.equal(result.images[1].temporary, true);
  assert.equal(typeof result.cleanup, 'function');
  await result.cleanup();
});

// ---------------------------------------------------------------------------
// SSRF protection
// ---------------------------------------------------------------------------

const SSRF_LITERAL_CASES = [
  ['IPv4 loopback', 'http://127.0.0.1/image.png', /127\.0\.0\.1/],
  ['IPv4 RFC1918 10/8', 'http://10.0.0.5/image.png', /10\.0\.0\.5/],
  ['IPv4 RFC1918 172.16/12', 'http://172.16.5.4/image.png', /172\.16\.5\.4/],
  ['IPv4 RFC1918 192.168/16', 'http://192.168.1.20/image.png', /192\.168\.1\.20/],
  ['IPv4 link-local metadata', 'http://169.254.169.254/latest/meta-data', /169\.254\.169\.254/],
  ['IPv6 loopback', 'http://[::1]/image.png', /::1/],
  ['IPv6 ULA', 'http://[fd00::1]/image.png', /fd00::1/],
];

for (const [name, url, addressPattern] of SSRF_LITERAL_CASES) {
  test(`blocks SSRF for ${name} without network access`, async () => {
    const lookup = createLookup(() => [PUBLIC_ADDRESS]);
    const fetch = createFetch([]);

    const error = await expectImageSourceError(
      resolveImageSources(
        [url],
        baseOptions({
          allowUrls: true,
          lookupImpl: lookup.impl,
          fetchImpl: fetch.impl,
        }),
      ),
      'URL_FORBIDDEN',
    );

    assert.match(error.message, addressPattern);
    assert.equal(lookup.calls.length, 0, 'IP literals must not trigger DNS lookups');
    assert.equal(fetch.calls.length, 0, 'blocked URLs must not be fetched');
  });
}

test('blocks localhost by hostname without DNS or fetch', async () => {
  const lookup = createLookup(() => [PUBLIC_ADDRESS]);
  const fetch = createFetch([]);

  const error = await expectImageSourceError(
    resolveImageSources(
      ['http://localhost/image.png'],
      baseOptions({
        allowUrls: true,
        lookupImpl: lookup.impl,
        fetchImpl: fetch.impl,
      }),
    ),
    'URL_FORBIDDEN',
  );
  assert.match(error.message, /localhost/);
  assert.equal(lookup.calls.length, 0);
  assert.equal(fetch.calls.length, 0);
});

test('blocks .local and .internal hostnames without DNS', async () => {
  const lookup = createLookup(() => [PUBLIC_ADDRESS]);
  const fetch = createFetch([]);

  for (const url of ['http://printer.local/image.png', 'http://metadata.internal/image.png']) {
    await expectImageSourceError(
      resolveImageSources(
        [url],
        baseOptions({
          allowUrls: true,
          lookupImpl: lookup.impl,
          fetchImpl: fetch.impl,
        }),
      ),
      'URL_FORBIDDEN',
    );
  }
  assert.equal(lookup.calls.length, 0);
  assert.equal(fetch.calls.length, 0);
});

test('blocks a public hostname that resolves to a private address', async () => {
  const lookup = createLookup((hostname) => {
    assert.equal(hostname, 'internal.example.com');
    return [{ address: '192.168.0.10', family: 4 }];
  });
  const fetch = createFetch([]);

  const error = await expectImageSourceError(
    resolveImageSources(
      ['http://internal.example.com/image.png'],
      baseOptions({
        allowUrls: true,
        lookupImpl: lookup.impl,
        fetchImpl: fetch.impl,
      }),
    ),
    'URL_FORBIDDEN',
  );
  assert.match(error.message, /192\.168\.0\.10/);
  assert.match(error.message, /internal\.example\.com/);
  assert.equal(lookup.calls.length, 1);
  assert.equal(fetch.calls.length, 0);
});

test('blocks a hostname that resolves to an IPv6 ULA address', async () => {
  const lookup = createLookup(() => [{ address: 'fd12:3456::1', family: 6 }]);
  const fetch = createFetch([]);

  const error = await expectImageSourceError(
    resolveImageSources(
      ['http://dualstack.example.com/image.png'],
      baseOptions({
        allowUrls: true,
        lookupImpl: lookup.impl,
        fetchImpl: fetch.impl,
      }),
    ),
    'URL_FORBIDDEN',
  );
  assert.match(error.message, /fd12:3456::1/);
  assert.equal(fetch.calls.length, 0);
});

test('blocks when any resolved address is private (mixed A records)', async () => {
  const lookup = createLookup(() => [
    { address: '93.184.216.34', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ]);
  const fetch = createFetch([]);

  await expectImageSourceError(
    resolveImageSources(
      ['https://mixed.example.com/image.png'],
      baseOptions({
        allowUrls: true,
        lookupImpl: lookup.impl,
        fetchImpl: fetch.impl,
      }),
    ),
    'URL_FORBIDDEN',
  );
  assert.equal(fetch.calls.length, 0);
});

test('maps DNS resolution failures to FETCH_FAILED', async () => {
  const lookup = createLookup(() => {
    const error = new Error('getaddrinfo ENOTFOUND no-such-host.example');
    error.code = 'ENOTFOUND';
    throw error;
  });
  const fetch = createFetch([]);

  const error = await expectImageSourceError(
    resolveImageSources(
      ['https://no-such-host.example/image.png'],
      baseOptions({
        allowUrls: true,
        lookupImpl: lookup.impl,
        fetchImpl: fetch.impl,
      }),
    ),
    'FETCH_FAILED',
  );
  assert.match(error.message, /no-such-host\.example/);
  assert.equal(fetch.calls.length, 0);
});

test('maps empty DNS answers to FETCH_FAILED', async () => {
  const lookup = createLookup(() => []);
  const fetch = createFetch([]);

  await expectImageSourceError(
    resolveImageSources(
      ['https://empty.example.com/image.png'],
      baseOptions({
        allowUrls: true,
        lookupImpl: lookup.impl,
        fetchImpl: fetch.impl,
      }),
    ),
    'FETCH_FAILED',
  );
  assert.equal(fetch.calls.length, 0);
});

test('allows private addresses when allowPrivateUrls is true', async () => {
  const fetch = createFetch([new Response(PNG_BYTES, { status: 200 })]);

  const result = await resolveImageSources(
    ['http://127.0.0.1/image.png'],
    baseOptions({
      allowUrls: true,
      allowPrivateUrls: true,
      fetchImpl: fetch.impl,
    }),
  );
  assert.equal(result.images[0].kind, 'url');
  assert.equal(fetch.calls.length, 1);
  await result.cleanup();
});

test('URL sources are forbidden when allowUrls is false', async () => {
  const lookup = createLookup(() => [PUBLIC_ADDRESS]);
  const fetch = createFetch([]);

  const error = await expectImageSourceError(
    resolveImageSources(
      ['https://example.com/image.png'],
      baseOptions({
        allowUrls: false,
        lookupImpl: lookup.impl,
        fetchImpl: fetch.impl,
      }),
    ),
    'URL_FORBIDDEN',
  );
  assert.match(error.message, /allowUrls/);
  assert.equal(lookup.calls.length, 0);
  assert.equal(fetch.calls.length, 0);
});

test('URL sources are forbidden by default (allowUrls undefined = fail closed)', async () => {
  const fetch = createFetch([]);
  await expectImageSourceError(
    resolveImageSources(['https://example.com/image.png'], {
      cwd: process.cwd(),
      maxImages: 4,
      maxBytes: 1024,
      fetchImpl: fetch.impl,
    }),
    'URL_FORBIDDEN',
  );
  assert.equal(fetch.calls.length, 0);
});

test('rejects URLs with embedded credentials with UNSUPPORTED_SCHEME', async () => {
  const lookup = createLookup(() => [PUBLIC_ADDRESS]);
  const fetch = createFetch([]);

  await expectImageSourceError(
    resolveImageSources(
      ['http://user:secret@example.com/image.png'],
      baseOptions({
        allowUrls: true,
        lookupImpl: lookup.impl,
        fetchImpl: fetch.impl,
      }),
    ),
    'UNSUPPORTED_SCHEME',
  );
  assert.equal(fetch.calls.length, 0);
});

test('rejects malformed URLs with UNSUPPORTED_SCHEME', async () => {
  await expectImageSourceError(
    resolveImageSources(['http://'], baseOptions({ allowUrls: true })),
    'UNSUPPORTED_SCHEME',
  );
});

// ---------------------------------------------------------------------------
// URL downloads
// ---------------------------------------------------------------------------

test('downloads an http(s) URL into a temporary file with manual redirects', async () => {
  const tempRoot = await makeTempDir();
  const lookup = createLookup(() => [PUBLIC_ADDRESS]);
  const fetch = createFetch([
    new Response(PNG_BYTES, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }),
  ]);

  const result = await resolveImageSources(
    ['https://img.example.com/cat.png'],
    baseOptions({
      allowUrls: true,
      tempDir: tempRoot,
      lookupImpl: lookup.impl,
      fetchImpl: fetch.impl,
    }),
  );

  const image = result.images[0];
  assert.equal(image.kind, 'url');
  assert.equal(image.mediaType, 'image/png');
  assert.equal(image.bytes, PNG_BYTES.length);
  assert.equal(image.temporary, true);
  assert.equal(image.source, 'https://img.example.com/cat.png');
  assert.match(image.path, /\.png$/);
  assert.deepEqual(await fs.readFile(image.path), PNG_BYTES);
  assert.deepEqual(lookup.calls, ['img.example.com']);
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, 'https://img.example.com/cat.png');
  assert.equal(fetch.calls[0].init.redirect, 'manual');
  assert.ok(fetch.calls[0].init.signal, 'fetch must receive an AbortSignal');

  const tempDir = path.dirname(image.path);
  await result.cleanup();
  await assert.rejects(fs.stat(tempDir), { code: 'ENOENT' });
});

test('follows a redirect chain, revalidating every hop', async () => {
  const tempRoot = await makeTempDir();
  const lookup = createLookup(() => [PUBLIC_ADDRESS]);
  const fetch = createFetch([
    new Response(null, {
      status: 302,
      headers: { location: 'http://cdn.example.com/step2.png' },
    }),
    new Response(null, {
      status: 301,
      headers: { location: 'https://img.example.com/final.png' },
    }),
    new Response(PNG_BYTES, { status: 200 }),
  ]);

  const result = await resolveImageSources(
    ['https://img.example.com/start.png'],
    baseOptions({
      allowUrls: true,
      tempDir: tempRoot,
      lookupImpl: lookup.impl,
      fetchImpl: fetch.impl,
    }),
  );

  assert.deepEqual(
    fetch.calls.map((call) => call.url),
    [
      'https://img.example.com/start.png',
      'http://cdn.example.com/step2.png',
      'https://img.example.com/final.png',
    ],
  );
  // DNS/SSRF validation ran again on every hop.
  assert.deepEqual(lookup.calls, ['img.example.com', 'cdn.example.com', 'img.example.com']);
  assert.deepEqual(await fs.readFile(result.images[0].path), PNG_BYTES);
  await result.cleanup();
});

test('blocks a redirect hop that lands on a private address', async () => {
  const tempRoot = await makeTempDir();
  const lookup = createLookup(() => [PUBLIC_ADDRESS]);
  const fetch = createFetch([
    new Response(null, {
      status: 302,
      headers: { location: 'http://10.0.0.5/secret.png' },
    }),
  ]);

  const error = await expectImageSourceError(
    resolveImageSources(
      ['https://public.example.com/image.png'],
      baseOptions({
        allowUrls: true,
        tempDir: tempRoot,
        lookupImpl: lookup.impl,
        fetchImpl: fetch.impl,
      }),
    ),
    'URL_FORBIDDEN',
  );
  assert.match(error.message, /10\.0\.0\.5/);
  assert.equal(fetch.calls.length, 1, 'the redirect target must not be fetched');
});

test('rejects too many redirects with FETCH_FAILED', async () => {
  const tempRoot = await makeTempDir();
  const lookup = createLookup(() => [PUBLIC_ADDRESS]);
  const fetch = createFetch([
    () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://loop.example.com/next.png' },
      }),
    () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://loop.example.com/next.png' },
      }),
    () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://loop.example.com/next.png' },
      }),
    () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://loop.example.com/next.png' },
      }),
  ]);

  const error = await expectImageSourceError(
    resolveImageSources(
      ['https://loop.example.com/start.png'],
      baseOptions({
        allowUrls: true,
        tempDir: tempRoot,
        maxRedirects: 2,
        lookupImpl: lookup.impl,
        fetchImpl: fetch.impl,
      }),
    ),
    'FETCH_FAILED',
  );
  assert.match(error.message, /maxRedirects=2/i);
  assert.equal(fetch.calls.length, 3, 'maxRedirects=2 allows 3 requests total');
});

test('rejects redirect responses without a Location header with FETCH_FAILED', async () => {
  const tempRoot = await makeTempDir();
  const lookup = createLookup(() => [PUBLIC_ADDRESS]);
  const fetch = createFetch([new Response(null, { status: 302 })]);

  const error = await expectImageSourceError(
    resolveImageSources(
      ['https://img.example.com/image.png'],
      baseOptions({
        allowUrls: true,
        tempDir: tempRoot,
        lookupImpl: lookup.impl,
        fetchImpl: fetch.impl,
      }),
    ),
    'FETCH_FAILED',
  );
  assert.match(error.message, /302/);
});

test('rejects non-2xx responses with FETCH_FAILED containing the status code', async () => {
  const tempRoot = await makeTempDir();
  const lookup = createLookup(() => [PUBLIC_ADDRESS]);
  const fetch = createFetch([new Response('nope', { status: 404 })]);

  const error = await expectImageSourceError(
    resolveImageSources(
      ['https://img.example.com/missing.png'],
      baseOptions({
        allowUrls: true,
        tempDir: tempRoot,
        lookupImpl: lookup.impl,
        fetchImpl: fetch.impl,
      }),
    ),
    'FETCH_FAILED',
  );
  assert.match(error.message, /404/);
});

test('rejects an oversized Content-Length without reading the body', async () => {
  const tempRoot = await makeTempDir();
  const lookup = createLookup(() => [PUBLIC_ADDRESS]);

  // Minimal Response-like object: reading the body would throw, so the test
  // fails if the Content-Length precheck does not short-circuit first.
  let readerRequested = false;
  let bodyCancelled = false;
  const body = {
    getReader() {
      readerRequested = true;
      throw new Error('body must not be read when Content-Length is too large');
    },
    cancel() {
      bodyCancelled = true;
      return Promise.resolve();
    },
  };
  const fetch = createFetch([
    { status: 200, headers: new Headers({ 'content-length': '5000' }), body },
  ]);

  await expectImageSourceError(
    resolveImageSources(
      ['https://img.example.com/huge.png'],
      baseOptions({
        allowUrls: true,
        tempDir: tempRoot,
        maxBytes: 100,
        lookupImpl: lookup.impl,
        fetchImpl: fetch.impl,
      }),
    ),
    'TOO_LARGE',
  );
  assert.equal(readerRequested, false, 'the body must not be read when Content-Length is too large');
  assert.equal(bodyCancelled, true, 'the unused body should be cancelled/disposed');
});

test('rejects a streamed body that exceeds maxBytes and cancels the stream', async () => {
  const tempRoot = await makeTempDir();
  const lookup = createLookup(() => [PUBLIC_ADDRESS]);
  const chunk = new Uint8Array(60).fill(0x41);
  let cancelled = false;
  let pulls = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulls += 1;
      if (pulls > 4) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  const fetch = createFetch([new Response(stream, { status: 200 })]);

  const error = await expectImageSourceError(
    resolveImageSources(
      ['https://img.example.com/stream.png'],
      baseOptions({
        allowUrls: true,
        tempDir: tempRoot,
        maxBytes: 100,
        lookupImpl: lookup.impl,
        fetchImpl: fetch.impl,
      }),
    ),
    'TOO_LARGE',
  );
  assert.match(error.message, /100/);
  assert.equal(cancelled, true, 'the response stream must be cancelled after exceeding the limit');
});

test('rejects downloaded content that is not an image with UNSUPPORTED_IMAGE', async () => {
  const tempRoot = await makeTempDir();
  const lookup = createLookup(() => [PUBLIC_ADDRESS]);
  const fetch = createFetch([
    new Response(Buffer.from('<html>not an image</html>'), { status: 200 }),
  ]);

  await expectImageSourceError(
    resolveImageSources(
      ['https://img.example.com/page.html'],
      baseOptions({
        allowUrls: true,
        tempDir: tempRoot,
        lookupImpl: lookup.impl,
        fetchImpl: fetch.impl,
      }),
    ),
    'UNSUPPORTED_IMAGE',
  );
});

test('times out a hanging download with FETCH_FAILED', async () => {
  const lookup = createLookup(() => [PUBLIC_ADDRESS]);

  const error = await expectImageSourceError(
    resolveImageSources(
      ['https://slow.example.com/image.png'],
      baseOptions({
        allowUrls: true,
        timeoutMs: 25,
        lookupImpl: lookup.impl,
        fetchImpl: hangingFetch(),
      }),
    ),
    'FETCH_FAILED',
  );
  assert.match(error.message, /timed out/i);
});

test('aborting the caller signal mid-download yields ABORTED with the reason', async () => {
  const lookup = createLookup(() => [PUBLIC_ADDRESS]);
  const controller = new AbortController();

  const promise = resolveImageSources(
    ['https://slow.example.com/image.png'],
    baseOptions({
      allowUrls: true,
      timeoutMs: 5000,
      signal: controller.signal,
      lookupImpl: lookup.impl,
      fetchImpl: hangingFetch(),
    }),
  );
  setTimeout(() => controller.abort('user cancelled'), 10);

  const error = await expectImageSourceError(promise, 'ABORTED');
  assert.match(error.message, /user cancelled/);
});

test('a pre-aborted signal yields ABORTED without fetching', async () => {
  const lookup = createLookup(() => [PUBLIC_ADDRESS]);
  const fetch = createFetch([]);
  const controller = new AbortController();
  controller.abort('cancelled before start');

  const error = await expectImageSourceError(
    resolveImageSources(
      ['https://img.example.com/image.png'],
      baseOptions({
        allowUrls: true,
        signal: controller.signal,
        lookupImpl: lookup.impl,
        fetchImpl: fetch.impl,
      }),
    ),
    'ABORTED',
  );
  assert.match(error.message, /cancelled before start/);
  assert.equal(fetch.calls.length, 0);
  assert.equal(lookup.calls.length, 0);
});

test('rejects invalid options with INVALID_ARGUMENT', async () => {
  await expectImageSourceError(
    resolveImageSources([PNG_BYTES], null),
    'INVALID_ARGUMENT',
  );
  await expectImageSourceError(
    resolveImageSources(['x.png'], baseOptions({ maxImages: 0 })),
    'INVALID_ARGUMENT',
  );
  await expectImageSourceError(
    resolveImageSources(['x.png'], baseOptions({ maxBytes: -1 })),
    'INVALID_ARGUMENT',
  );
  await expectImageSourceError(
    resolveImageSources(['x.png'], baseOptions({ timeoutMs: 0 })),
    'INVALID_ARGUMENT',
  );
  await expectImageSourceError(
    resolveImageSources(['x.png'], baseOptions({ maxRedirects: -1 })),
    'INVALID_ARGUMENT',
  );
});

// ---------------------------------------------------------------------------
// Temporary directory lifecycle
// ---------------------------------------------------------------------------

test('cleans up the temporary directory when a later source fails', async () => {
  const tempRoot = await makeTempDir();
  const dir = await makeTempDir();

  await expectImageSourceError(
    resolveImageSources(
      [dataUrl('image/png', PNG_BYTES), 'missing-after-data.png'],
      baseOptions({ cwd: dir, allowDataUrls: true, tempDir: tempRoot }),
    ),
    'NOT_FOUND',
  );

  assert.deepEqual(
    await fs.readdir(tempRoot),
    [],
    'a failed resolveImageSources call must remove its temporary directory itself',
  );
});

test('multiple data URLs share one temp dir which cleanup removes', async () => {
  const tempRoot = await makeTempDir();
  const result = await resolveImageSources(
    [dataUrl('image/png', PNG_BYTES), dataUrl('image/gif', GIF_BYTES)],
    baseOptions({ allowDataUrls: true, tempDir: tempRoot }),
  );
  const dirs = new Set(result.images.map((image) => path.dirname(image.path)));
  assert.equal(dirs.size, 1);
  const [tempDir] = [...dirs];
  assert.ok((await fs.stat(tempDir)).isDirectory());
  await result.cleanup();
  await assert.rejects(fs.stat(tempDir), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(tempRoot), []);
});

test('the returned cleanup is a function and safe to call repeatedly', async () => {
  const dir = await makeTempDir();
  const filePath = await writeFile(dir, 'pic.png', PNG_BYTES);
  const result = await resolveImageSources([filePath], baseOptions());
  assert.equal(typeof result.cleanup, 'function');
  await result.cleanup();
  await result.cleanup();
  await result.cleanup();
});

test('works with the shared tiny.png fixture', async () => {
  const result = await resolveImageSources([FIXTURE_PATH], baseOptions());
  const image = result.images[0];
  assert.equal(image.kind, 'file');
  assert.equal(image.mediaType, 'image/png');
  assert.equal(image.bytes, (await fs.stat(FIXTURE_PATH)).size);
  await result.cleanup();
});
