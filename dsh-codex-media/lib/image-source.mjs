/**
 * Image source resolution for the `codex_vision` tool.
 *
 * Turns one or more "image sources" supplied by a model (local paths, http(s)
 * URLs, `file://` URLs or `data:image/...;base64,` URLs) into local files that
 * can be handed to `codex exec -i/--image`.
 *
 * Responsibilities:
 * - classify a source and resolve it to an absolute local path;
 * - sniff the image format from magic bytes only (PNG/JPEG/WebP/GIF);
 * - enforce per-image byte limits and the maximum image count;
 * - protect URL downloads against SSRF (DNS resolution + private range checks,
 *   manual redirect handling with a full re-check on every hop);
 * - enforce a download timeout and a streaming byte cap (never buffer an
 *   over-limit body completely);
 * - create a single per-call temporary directory and clean it up (idempotent
 *   `cleanup()` plus self-cleanup when this function throws).
 *
 * Only `node:*` built-in modules may be imported here.
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Supported media types and the file extension used when writing temp files. */
const MEDIA_TYPE_EXTENSIONS = Object.freeze({
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
});

/** Number of leading bytes read from a local file for magic-byte sniffing. */
const HEADER_BYTES = 16;

/** Default per-URL download timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 20_000;

/** Default number of redirects allowed for a single URL download. */
const DEFAULT_MAX_REDIRECTS = 3;

/** PNG signature bytes (the first 8 bytes of every PNG file). */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Error thrown for every expected image-source failure.
 *
 * `code` is one of the contract codes; `source` is the offending input source
 * when one is known.
 */
export class ImageSourceError extends Error {
  /**
   * @param {string} code One of the documented error codes.
   * @param {string} message Model-facing, actionable error message.
   * @param {{ source?: string, cause?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'ImageSourceError';
    this.code = code;
    /** @type {string|undefined} Offending input source, when known. */
    this.source = options?.source;
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/**
 * Sniff an image media type from magic bytes only.
 *
 * Recognises PNG, JPEG, GIF (87a/89a) and WebP; anything else yields undefined.
 *
 * @param {Uint8Array} bytes Leading bytes of the candidate image.
 * @returns {'image/png'|'image/jpeg'|'image/webp'|'image/gif'|undefined}
 */
export function sniffImageMediaType(bytes) {
  if (!bytes || typeof bytes.length !== 'number' || bytes.length === 0) {
    return undefined;
  }
  const b = bytes;

  if (
    b.length >= PNG_MAGIC.length &&
    PNG_MAGIC.every((value, index) => b[index] === value)
  ) {
    return 'image/png';
  }

  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    b.length >= 6 &&
    b[0] === 0x47 && // G
    b[1] === 0x49 && // I
    b[2] === 0x46 && // F
    b[3] === 0x38 && // 8
    (b[4] === 0x37 || b[4] === 0x39) && // 7 / 9
    b[5] === 0x61 // a
  ) {
    return 'image/gif';
  }

  if (
    b.length >= 12 &&
    b[0] === 0x52 && // R
    b[1] === 0x49 && // I
    b[2] === 0x46 && // F
    b[3] === 0x46 && // F
    b[8] === 0x57 && // W
    b[9] === 0x45 && // E
    b[10] === 0x42 && // B
    b[11] === 0x50 // P
  ) {
    return 'image/webp';
  }

  return undefined;
}

/**
 * Resolve model-supplied image sources to local files usable by `codex -i`.
 *
 * The returned `cleanup()` removes the per-call temporary directory
 * (recursively) and is safe to call multiple times. Local files are never
 * copied; only URL/data sources are materialised in the temporary directory.
 *
 * @param {string[]} sources Local paths, http(s) URLs, file:// URLs or data:image URLs.
 * @param {object} options
 * @param {string} [options.cwd] Base directory for relative local paths (default: process.cwd()).
 * @param {number} [options.maxImages] Maximum number of images (default: unlimited).
 * @param {number} [options.maxBytes] Per-image byte limit (default: unlimited).
 * @param {boolean} [options.allowUrls] Whether http(s) sources are allowed (default: false).
 * @param {boolean} [options.allowDataUrls] Whether data: sources are allowed (default: false).
 * @param {boolean} [options.allowPrivateUrls] Whether private/local network hosts are allowed (default: false).
 * @param {AbortSignal} [options.signal] Caller abort signal.
 * @param {string} [options.tempDir] Root directory for temporary files (default: os.tmpdir()).
 * @param {number} [options.timeoutMs] Per-URL download timeout (default: 20000).
 * @param {number} [options.maxRedirects] Redirect budget per URL (default: 3).
 * @param {typeof fetch} [options.fetchImpl] Injectable fetch implementation (tests).
 * @param {(hostname: string) => Promise<Array<{ address: string, family: number }>>} [options.lookupImpl]
 *   Injectable DNS lookup implementation (tests).
 * @returns {Promise<{
 *   images: Array<{
 *     source: string,
 *     kind: 'file'|'url'|'data',
 *     path: string,
 *     mediaType: string,
 *     bytes: number,
 *     temporary: boolean,
 *   }>,
 *   cleanup: () => Promise<void>,
 * }>}
 */
export async function resolveImageSources(sources, options) {
  const opts = normalizeOptions(options);
  validateSources(sources, opts.maxImages);
  throwIfAborted(opts.signal);

  /** @type {{ tempDirPath: string|null }} */
  const state = { tempDirPath: null };

  /** @type {Promise<void>|null} Shared promise so concurrent calls are safe. */
  let cleanupPromise = null;
  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      const dir = state.tempDirPath;
      state.tempDirPath = null;
      if (!dir) return;
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        // Best effort: cleanup must never mask the original result/error.
      }
    })();
    return cleanupPromise;
  };

  try {
    /** @type {Array<object>} */
    const images = [];
    for (let index = 0; index < sources.length; index += 1) {
      throwIfAborted(opts.signal);
      images.push(await resolveOneSource(sources[index], index, opts, state));
    }
    return { images, cleanup };
  } catch (error) {
    await cleanup();
    if (error instanceof ImageSourceError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new ImageSourceError(
      'INVALID_ARGUMENT',
      `Failed to resolve image sources: ${detail}. Check the image paths/URLs and the options passed to resolveImageSources.`,
      { cause: error },
    );
  }
}

/**
 * Validate and normalise the options object.
 *
 * @param {object} options
 * @returns {object} Normalised options with defaults applied.
 */
function normalizeOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new ImageSourceError(
      'INVALID_ARGUMENT',
      'resolveImageSources(sources, options): an options object is required (cwd, maxImages, maxBytes, allowUrls, allowDataUrls, allowPrivateUrls).',
    );
  }

  const cwd =
    typeof options.cwd === 'string' && options.cwd.length > 0
      ? options.cwd
      : process.cwd();

  const maxImages = options.maxImages == null ? Infinity : options.maxImages;
  if (
    maxImages !== Infinity &&
    (!Number.isInteger(maxImages) || maxImages < 1)
  ) {
    throw new ImageSourceError(
      'INVALID_ARGUMENT',
      `options.maxImages must be a positive integer; received ${String(options.maxImages)}.`,
    );
  }

  const maxBytes = options.maxBytes == null ? Infinity : options.maxBytes;
  if (maxBytes !== Infinity && (!Number.isFinite(maxBytes) || maxBytes < 1)) {
    throw new ImageSourceError(
      'INVALID_ARGUMENT',
      `options.maxBytes must be a positive finite number; received ${String(options.maxBytes)}.`,
    );
  }

  const timeoutMs =
    options.timeoutMs == null ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ImageSourceError(
      'INVALID_ARGUMENT',
      `options.timeoutMs must be a positive number of milliseconds; received ${String(options.timeoutMs)}.`,
    );
  }

  const maxRedirects =
    options.maxRedirects == null ? DEFAULT_MAX_REDIRECTS : options.maxRedirects;
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0) {
    throw new ImageSourceError(
      'INVALID_ARGUMENT',
      `options.maxRedirects must be a non-negative integer; received ${String(options.maxRedirects)}.`,
    );
  }

  const tempDir =
    typeof options.tempDir === 'string' && options.tempDir.length > 0
      ? options.tempDir
      : os.tmpdir();

  const signal = options.signal ?? undefined;
  if (
    signal != null &&
    (typeof signal !== 'object' || typeof signal.aborted !== 'boolean')
  ) {
    throw new ImageSourceError(
      'INVALID_ARGUMENT',
      'options.signal must be an AbortSignal (or omitted).',
    );
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new ImageSourceError(
      'INVALID_ARGUMENT',
      'No fetch implementation is available: pass options.fetchImpl or run on a Node.js version with a global fetch.',
    );
  }

  const lookupImpl = options.lookupImpl ?? defaultLookupImpl;
  if (typeof lookupImpl !== 'function') {
    throw new ImageSourceError(
      'INVALID_ARGUMENT',
      'options.lookupImpl must be a function (hostname) => Promise<Array<{address, family}>>.',
    );
  }

  return {
    cwd,
    maxImages,
    maxBytes,
    timeoutMs,
    maxRedirects,
    tempDir,
    signal,
    fetchImpl,
    lookupImpl,
    allowUrls: options.allowUrls === true,
    allowDataUrls: options.allowDataUrls === true,
    allowPrivateUrls: options.allowPrivateUrls === true,
  };
}

/**
 * Validate the `sources` argument.
 *
 * @param {unknown} sources
 * @param {number} maxImages
 */
function validateSources(sources, maxImages) {
  if (!Array.isArray(sources)) {
    throw new ImageSourceError(
      'INVALID_ARGUMENT',
      `options.sources must be an array of image sources; received ${describeValueType(sources)}. Pass 1..${formatLimit(maxImages)} local paths, http(s) URLs or data:image URLs.`,
    );
  }
  if (sources.length === 0) {
    throw new ImageSourceError(
      'INVALID_ARGUMENT',
      'At least one image source is required (local path, http(s) URL or data:image URL).',
    );
  }
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    if (typeof source !== 'string' || source.trim() === '') {
      throw new ImageSourceError(
        'INVALID_ARGUMENT',
        `sources[${index}] must be a non-empty string (local path, http(s) URL or data:image URL); received ${describeValueType(source)}.`,
        { source: typeof source === 'string' ? source : undefined },
      );
    }
  }
  if (sources.length > maxImages) {
    throw new ImageSourceError(
      'TOO_MANY_IMAGES',
      `Too many images: ${sources.length} sources provided but maxImages is ${maxImages}. Reduce the number of images to at most ${maxImages}.`,
    );
  }
}

/**
 * Resolve a single source according to the contract classification order.
 *
 * @param {string} source Original source string.
 * @param {number} index Position within the sources array.
 * @param {object} opts Normalised options.
 * @param {{ tempDirPath: string|null }} state Temp dir state.
 * @returns {Promise<object>} Resolved image descriptor.
 */
async function resolveOneSource(source, index, opts, state) {
  const trimmed = source.trim();

  if (/^https?:\/\//i.test(trimmed)) {
    return resolveUrlSource(source, trimmed, index, opts, state);
  }

  if (/^data:/i.test(trimmed)) {
    return resolveDataUrlSource(source, trimmed, index, opts, state);
  }

  if (/^file:\/\//i.test(trimmed)) {
    let localPath;
    try {
      localPath = fileURLToPath(trimmed);
    } catch (cause) {
      throw new ImageSourceError(
        'INVALID_ARGUMENT',
        `Invalid file:// URL "${source}": ${cause instanceof Error ? cause.message : String(cause)}. Use a normal local path or a well-formed file:// URL.`,
        { source, cause },
      );
    }
    return resolveLocalFileSource(source, localPath, opts);
  }

  return resolveLocalFileSource(source, trimmed, opts);
}

/**
 * Validate a local file and sniff its media type.
 *
 * @param {string} source Original source string.
 * @param {string} inputPath Absolute path or path relative to options.cwd.
 * @param {object} opts Normalised options.
 * @returns {Promise<object>} Resolved image descriptor (never copied).
 */
async function resolveLocalFileSource(source, inputPath, opts) {
  const trimmed = inputPath.trim();
  const absolutePath = path.isAbsolute(trimmed)
    ? path.normalize(trimmed)
    : path.resolve(opts.cwd, trimmed);

  let stats;
  try {
    stats = await fs.stat(absolutePath);
  } catch (cause) {
    const code = cause && cause.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new ImageSourceError(
        'NOT_FOUND',
        `Image file not found: "${source}" (resolved to "${absolutePath}"). Pass an existing local path, an http(s) URL or a data:image URL.`,
        { source, cause },
      );
    }
    throw new ImageSourceError(
      'NOT_A_FILE',
      `Cannot read image file "${source}" (resolved to "${absolutePath}"): ${cause instanceof Error ? cause.message : String(cause)}. Check file permissions.`,
      { source, cause },
    );
  }

  if (!stats.isFile()) {
    throw new ImageSourceError(
      'NOT_A_FILE',
      `Image source "${source}" is not a regular file (resolved to "${absolutePath}"). Pass a file path, not a directory, socket or device.`,
      { source },
    );
  }

  if (stats.size === 0) {
    throw new ImageSourceError(
      'EMPTY_IMAGE',
      `Image file "${source}" is empty (0 bytes). Provide a non-empty PNG/JPEG/WebP/GIF file.`,
      { source },
    );
  }

  if (stats.size > opts.maxBytes) {
    throw new ImageSourceError(
      'TOO_LARGE',
      `Image file "${source}" is ${stats.size} bytes, exceeding maxBytes=${opts.maxBytes}. Resize/compress the image or raise the configured limit.`,
      { source },
    );
  }

  let header;
  try {
    header = await readFileHeader(absolutePath, HEADER_BYTES);
  } catch (cause) {
    const code = cause && cause.code;
    if (code === 'ENOENT') {
      throw new ImageSourceError(
        'NOT_FOUND',
        `Image file not found: "${source}" (resolved to "${absolutePath}").`,
        { source, cause },
      );
    }
    throw new ImageSourceError(
      'NOT_A_FILE',
      `Cannot read image file "${source}" (resolved to "${absolutePath}"): ${cause instanceof Error ? cause.message : String(cause)}.`,
      { source, cause },
    );
  }

  const mediaType = sniffImageMediaType(header);
  if (!mediaType) {
    throw new ImageSourceError(
      'UNSUPPORTED_IMAGE',
      `Image file "${source}" is not a supported image. Supported formats are PNG, JPEG, WebP and GIF (detected by magic bytes; the extension is ignored).`,
      { source },
    );
  }

  return {
    source,
    kind: 'file',
    path: absolutePath,
    mediaType,
    bytes: stats.size,
    temporary: false,
  };
}

/**
 * Read the first `length` bytes of a file.
 *
 * @param {string} filePath
 * @param {number} length
 * @returns {Promise<Buffer>} A view of the bytes actually read.
 */
async function readFileHeader(filePath, length) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Parse a `data:image/...;base64,...` URL and decode its payload.
 *
 * @param {string} source Original source string (for errors).
 * @param {string} trimmed Trimmed data URL.
 * @returns {{ mediaType: string, bytes: Buffer }}
 */
function parseDataUrl(source, trimmed) {
  const match = /^data:([^,]*),(.*)$/is.exec(trimmed);
  if (!match) {
    throw new ImageSourceError(
      'UNSUPPORTED_IMAGE',
      `Invalid data URL for "${source}". Expected data:image/<png|jpeg|webp|gif>;base64,<payload>.`,
      { source },
    );
  }

  const metadata = match[1];
  const payload = match[2];
  const metaParts = metadata.split(';');
  const declaredType = (metaParts[0] || '').trim().toLowerCase();
  const parameters = metaParts.slice(1).map((part) => part.trim().toLowerCase());

  if (!Object.hasOwn(MEDIA_TYPE_EXTENSIONS, declaredType)) {
    throw new ImageSourceError(
      'UNSUPPORTED_IMAGE',
      `Unsupported data URL media type "${declaredType || '(missing)'}" in "${source}". Only image/png, image/jpeg, image/webp and image/gif data URLs are supported.`,
      { source },
    );
  }

  if (parameters.length !== 1 || parameters[0] !== 'base64') {
    throw new ImageSourceError(
      'UNSUPPORTED_IMAGE',
      `Unsupported data URL encoding in "${source}". Only base64 data URLs are supported (expected exactly ";base64," after the media type).`,
      { source },
    );
  }

  const compact = payload.replace(/\s+/g, '');
  if (compact === '') {
    return { mediaType: declaredType, bytes: Buffer.alloc(0) };
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new ImageSourceError(
      'INVALID_ARGUMENT',
      `Invalid base64 payload in data URL "${shortSource(source)}". The payload must contain only base64 characters with optional trailing "=" padding.`,
      { source },
    );
  }
  if (compact.length % 4 === 1) {
    throw new ImageSourceError(
      'INVALID_ARGUMENT',
      `Invalid base64 payload length in data URL "${shortSource(source)}". The payload must be valid base64 (length modulo 4 cannot be 1).`,
      { source },
    );
  }

  const bytes = Buffer.from(compact, 'base64');
  const canonical = bytes.toString('base64').replace(/=+$/, '');
  if (canonical !== compact.replace(/=+$/, '')) {
    throw new ImageSourceError(
      'INVALID_ARGUMENT',
      `Invalid base64 payload in data URL "${shortSource(source)}". The payload does not decode as base64.`,
      { source },
    );
  }

  return { mediaType: declaredType, bytes };
}

/**
 * Resolve a `data:image/...;base64,...` source into a temporary file.
 *
 * @param {string} source Original source string.
 * @param {string} trimmed Trimmed data URL.
 * @param {number} index Position within the sources array.
 * @param {object} opts Normalised options.
 * @param {{ tempDirPath: string|null }} state Temp dir state.
 * @returns {Promise<object>} Resolved image descriptor.
 */
async function resolveDataUrlSource(source, trimmed, index, opts, state) {
  if (!opts.allowDataUrls) {
    throw new ImageSourceError(
      'URL_FORBIDDEN',
      `data: image sources are disabled (allowDataUrls=false). Enable allowDataUrls or pass a local path / http(s) URL instead. Offending source: "${shortSource(source)}".`,
      { source },
    );
  }

  const parsed = parseDataUrl(source, trimmed);

  if (parsed.bytes.length === 0) {
    throw new ImageSourceError(
      'EMPTY_IMAGE',
      `data URL "${shortSource(source)}" decodes to 0 bytes. Provide a non-empty base64-encoded PNG/JPEG/WebP/GIF image.`,
      { source },
    );
  }

  if (parsed.bytes.length > opts.maxBytes) {
    throw new ImageSourceError(
      'TOO_LARGE',
      `data URL "${shortSource(source)}" decodes to ${parsed.bytes.length} bytes, exceeding maxBytes=${opts.maxBytes}. Resize/compress the image or raise the configured limit.`,
      { source },
    );
  }

  const filePath = await writeTemporaryImage(
    parsed.bytes,
    parsed.mediaType,
    index,
    opts,
    state,
    source,
  );

  return {
    source,
    kind: 'data',
    path: filePath,
    mediaType: parsed.mediaType,
    bytes: parsed.bytes.length,
    temporary: true,
  };
}

/**
 * Resolve an http(s) URL by downloading it into a temporary file.
 *
 * SSRF protection is applied before the first request and again on every
 * redirect hop. Redirects are handled manually.
 *
 * @param {string} source Original source string.
 * @param {string} trimmed Trimmed URL string.
 * @param {number} index Position within the sources array.
 * @param {object} opts Normalised options.
 * @param {{ tempDirPath: string|null }} state Temp dir state.
 * @returns {Promise<object>} Resolved image descriptor.
 */
async function resolveUrlSource(source, trimmed, index, opts, state) {
  let currentUrl;
  try {
    currentUrl = new URL(trimmed);
  } catch (cause) {
    throw new ImageSourceError(
      'UNSUPPORTED_SCHEME',
      `Invalid URL "${source}". Pass a full http(s) URL (for example https://example.com/image.png) or a local file path.`,
      { source, cause },
    );
  }

  // Per-download abort plumbing: caller signal + timeout, combined manually so
  // that we always know which one fired.
  const requestController = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    requestController.abort(
      new DOMException('image download timed out', 'TimeoutError'),
    );
  }, opts.timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();

  const onCallerAbort = () => {
    requestController.abort(opts.signal.reason);
  };
  if (opts.signal) {
    opts.signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  try {
    let redirectsFollowed = 0;
    /** @type {Response} */
    let response;

    while (true) {
      throwIfAborted(opts.signal);
      await assertUrlDownloadAllowed(currentUrl, source, opts);

      try {
        response = await opts.fetchImpl(currentUrl.href, {
          method: 'GET',
          redirect: 'manual',
          signal: requestController.signal,
          headers: {
            accept: 'image/png,image/jpeg,image/webp,image/gif,*/*;q=0.5',
          },
        });
      } catch (cause) {
        throw mapDownloadError(cause, source, opts, timedOut);
      }

      if (
        !response ||
        typeof response.status !== 'number' ||
        !response.headers ||
        typeof response.headers.get !== 'function'
      ) {
        throw new ImageSourceError(
          'FETCH_FAILED',
          `Unexpected response while downloading "${source}": the fetch implementation did not return a Response-like object. Check the configured fetch implementation.`,
          { source },
        );
      }

      if (response.status >= 300 && response.status <= 399) {
        const location = response.headers.get('location');
        await discardResponseBody(response);
        if (!location) {
          throw new ImageSourceError(
            'FETCH_FAILED',
            `Download failed with HTTP ${response.status} for "${source}" and no Location header was provided. The URL may have moved; use the final URL directly.`,
            { source },
          );
        }
        if (redirectsFollowed >= opts.maxRedirects) {
          throw new ImageSourceError(
            'FETCH_FAILED',
            `Too many redirects while downloading "${source}" (maxRedirects=${opts.maxRedirects}, last status HTTP ${response.status}). Use the final URL directly or raise maxRedirects.`,
            { source },
          );
        }
        redirectsFollowed += 1;
        let nextUrl;
        try {
          nextUrl = new URL(location, currentUrl);
        } catch (cause) {
          throw new ImageSourceError(
            'FETCH_FAILED',
            `Invalid redirect target "${location}" while downloading "${source}".`,
            { source, cause },
          );
        }
        currentUrl = nextUrl;
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        await discardResponseBody(response);
        throw new ImageSourceError(
          'FETCH_FAILED',
          `Download failed with HTTP ${response.status} for "${source}". Check that the URL points at a publicly accessible image.`,
          { source },
        );
      }
      break;
    }

    const declaredLength = parseContentLength(response.headers.get('content-length'));
    if (declaredLength !== null && declaredLength > opts.maxBytes) {
      await discardResponseBody(response);
      throw new ImageSourceError(
        'TOO_LARGE',
        `Image "${source}" is ${declaredLength} bytes according to Content-Length, exceeding maxBytes=${opts.maxBytes}. Resize/compress the image or raise the configured limit.`,
        { source },
      );
    }

    let bytes;
    try {
      bytes = await readResponseBody(response, opts.maxBytes, source);
    } catch (cause) {
      throw mapDownloadError(cause, source, opts, timedOut);
    }

    const mediaType = sniffImageMediaType(bytes);
    if (!mediaType) {
      throw new ImageSourceError(
        'UNSUPPORTED_IMAGE',
        `Downloaded content from "${source}" is not a supported image (${bytes.length} bytes). Supported formats are PNG, JPEG, WebP and GIF (detected by magic bytes).`,
        { source },
      );
    }

    const filePath = await writeTemporaryImage(
      bytes,
      mediaType,
      index,
      opts,
      state,
      source,
    );

    return {
      source,
      kind: 'url',
      path: filePath,
      mediaType,
      bytes: bytes.length,
      temporary: true,
    };
  } finally {
    clearTimeout(timer);
    if (opts.signal) {
      opts.signal.removeEventListener('abort', onCallerAbort);
    }
  }
}

/**
 * Validate scheme, policy and SSRF constraints for one URL hop.
 *
 * @param {URL} url Parsed URL of the current hop.
 * @param {string} source Original source string (for errors).
 * @param {object} opts Normalised options.
 * @returns {Promise<void>}
 */
async function assertUrlDownloadAllowed(url, source, opts) {
  const protocol = url.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new ImageSourceError(
      'UNSUPPORTED_SCHEME',
      `Unsupported URL scheme "${protocol}" in "${shortSource(source)}". Only http: and https: URLs can be downloaded.`,
      { source },
    );
  }

  if (url.username || url.password) {
    throw new ImageSourceError(
      'UNSUPPORTED_SCHEME',
      `URLs with embedded credentials are not supported: "${shortSource(source)}". Remove the username/password from the URL.`,
      { source },
    );
  }

  if (!opts.allowUrls) {
    throw new ImageSourceError(
      'URL_FORBIDDEN',
      `URL image sources are disabled (allowUrls=false). Enable allowUrls, or download the image and pass a local path / data URL instead. Offending source: "${shortSource(source)}".`,
      { source },
    );
  }

  if (opts.allowPrivateUrls) return;

  const hostname = normalizeHostname(url.hostname);
  if (!hostname) {
    throw new ImageSourceError(
      'FETCH_FAILED',
      `URL "${shortSource(source)}" has no hostname.`,
      { source },
    );
  }

  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new ImageSourceError(
      'URL_FORBIDDEN',
      `Blocked URL host "${hostname}" for "${shortSource(source)}": localhost/.local/.internal hosts are private. Set allowPrivateUrls=true only if you intentionally allow local network access.`,
      { source },
    );
  }

  if (isIP(hostname) !== 0) {
    const blocked = describeBlockedAddress(hostname);
    if (blocked) {
      throw new ImageSourceError(
        'URL_FORBIDDEN',
        `Blocked URL host ${hostname} for "${shortSource(source)}": ${blocked}. Private, loopback and link-local addresses are not allowed (allowPrivateUrls=false).`,
        { source },
      );
    }
    return;
  }

  let records;
  try {
    records = await opts.lookupImpl(hostname);
  } catch (cause) {
    throw new ImageSourceError(
      'FETCH_FAILED',
      `DNS lookup failed for "${hostname}" while resolving "${shortSource(source)}": ${cause instanceof Error ? cause.message : String(cause)}. Check the hostname/network.`,
      { source, cause },
    );
  }

  if (!Array.isArray(records) || records.length === 0) {
    throw new ImageSourceError(
      'FETCH_FAILED',
      `DNS lookup for "${hostname}" (source "${shortSource(source)}") returned no addresses. Check the hostname.`,
      { source },
    );
  }

  let checked = 0;
  for (const record of records) {
    const address = typeof record === 'string' ? record : record?.address;
    if (typeof address !== 'string' || address.length === 0) continue;
    checked += 1;
    const blocked = describeBlockedAddress(address);
    if (blocked) {
      throw new ImageSourceError(
        'URL_FORBIDDEN',
        `Blocked URL host "${hostname}" for "${shortSource(source)}": DNS resolved to ${address} (${blocked}). Private, loopback and link-local addresses are not allowed (allowPrivateUrls=false).`,
        { source },
      );
    }
  }

  if (checked === 0) {
    throw new ImageSourceError(
      'FETCH_FAILED',
      `DNS lookup for "${hostname}" (source "${shortSource(source)}") returned no usable addresses.`,
      { source },
    );
  }
}

/**
 * Default DNS lookup: resolves all A/AAAA records.
 *
 * @param {string} hostname
 * @returns {Promise<Array<{ address: string, family: number }>>}
 */
async function defaultLookupImpl(hostname) {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

/**
 * Normalise a URL hostname for local address checks.
 *
 * Strips IPv6 brackets and a trailing root dot and lowercases the result.
 *
 * @param {string} hostname
 * @returns {string}
 */
function normalizeHostname(hostname) {
  let host = String(hostname ?? '').trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  while (host.endsWith('.')) {
    host = host.slice(0, -1);
  }
  return host;
}

/**
 * Describe why an IP address must be blocked, or return null when it is public.
 *
 * @param {string} address IPv4/IPv6 address (brackets/zone handled).
 * @returns {string|null} Human-readable reason, or null when allowed.
 */
function describeBlockedAddress(address) {
  if (typeof address !== 'string') return null;
  let host = address.trim();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  const zoneIndex = host.indexOf('%');
  if (zoneIndex !== -1) host = host.slice(0, zoneIndex);
  if (host === '') return null;

  const ipv4 = parseIpv4(host);
  if (ipv4) return describeBlockedIpv4(ipv4);

  const ipv6 = parseIpv6(host);
  if (ipv6) return describeBlockedIpv6(ipv6);

  return null;
}

/**
 * @param {number[]} octets Four IPv4 octets.
 * @returns {string|null}
 */
function describeBlockedIpv4(octets) {
  const [a, b] = octets;
  // 0.0.0.0/8: "this network", includes the unspecified address 0.0.0.0.
  if (a === 0) return 'unspecified/this-network address (0.0.0.0/8)';
  // 127.0.0.0/8: loopback.
  if (a === 127) return 'loopback address (127.0.0.0/8)';
  // RFC1918 private ranges.
  if (a === 10) return 'RFC1918 private address (10.0.0.0/8)';
  if (a === 172 && b >= 16 && b <= 31) {
    return 'RFC1918 private address (172.16.0.0/12)';
  }
  if (a === 192 && b === 168) {
    return 'RFC1918 private address (192.168.0.0/16)';
  }
  // 169.254.0.0/16: link-local (includes cloud metadata endpoints).
  if (a === 169 && b === 254) return 'link-local address (169.254.0.0/16)';
  // 224.0.0.0/4: multicast.
  if (a >= 224 && a <= 239) return 'multicast address (224.0.0.0/4)';
  // 255.255.255.255: limited broadcast.
  if (a === 255 && b === 255) return 'broadcast address (255.255.255.255)';
  return null;
}

/**
 * @param {number[]} groups Eight 16-bit IPv6 groups.
 * @returns {string|null}
 */
function describeBlockedIpv6(groups) {
  const g0 = groups[0];
  const g5 = groups[5];
  const g6 = groups[6];
  const g7 = groups[7];

  const allZero = groups.every((group) => group === 0);
  if (allZero) return 'unspecified address (::)';

  // ::1: loopback.
  if (groups.slice(0, 7).every((group) => group === 0) && g7 === 1) {
    return 'loopback address (::1)';
  }

  // ::ffff:0:0/96: IPv4-mapped address, judge the embedded IPv4 address.
  const highZero =
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0;
  if (highZero && g5 === 0xffff) {
    const embedded = [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff];
    const reason = describeBlockedIpv4(embedded);
    return reason ? `IPv4-mapped ${embedded.join('.')}: ${reason}` : null;
  }

  // fc00::/7: unique local addresses (ULA).
  if ((g0 & 0xfe00) === 0xfc00) {
    return 'unique local address (fc00::/7)';
  }

  // fe80::/10: link-local.
  if ((g0 & 0xffc0) === 0xfe80) {
    return 'link-local address (fe80::/10)';
  }

  // ff00::/8: multicast.
  if ((g0 & 0xff00) === 0xff00) {
    return 'multicast address (ff00::/8)';
  }

  return null;
}

/**
 * Parse a dotted-quad IPv4 address.
 *
 * @param {string} value
 * @returns {number[]|null} Four octets, or null when not a valid IPv4 literal.
 */
function parseIpv4(value) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!match) return null;
  const octets = match.slice(1).map((part) => Number(part));
  if (octets.some((octet) => octet > 255)) return null;
  return octets;
}

/**
 * Parse an IPv6 address (including embedded IPv4 tails) into 8 groups.
 *
 * @param {string} value
 * @returns {number[]|null} Eight 16-bit groups, or null when invalid.
 */
function parseIpv6(value) {
  let input = value;
  if (input.startsWith('[') && input.endsWith(']')) {
    input = input.slice(1, -1);
  }
  const zoneIndex = input.indexOf('%');
  if (zoneIndex !== -1) input = input.slice(0, zoneIndex);
  if (input === '') return null;

  const doubleColons = input.split('::').length - 1;
  if (doubleColons > 1) return null;
  const hasDoubleColon = doubleColons === 1;

  const expand = (part) => {
    if (part === '') return [];
    const segments = part.split(':');
    /** @type {string[]} */
    const groups = [];
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (segment.includes('.')) {
        if (index !== segments.length - 1) return null;
        const ipv4 = parseIpv4(segment);
        if (!ipv4) return null;
        groups.push(
          (((ipv4[0] << 8) | ipv4[1]) >>> 0).toString(16),
          (((ipv4[2] << 8) | ipv4[3]) >>> 0).toString(16),
        );
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(segment)) return null;
      groups.push(segment);
    }
    return groups;
  };

  let fullGroups;
  if (hasDoubleColon) {
    const [headPart, tailPart] = input.split('::');
    const head = expand(headPart);
    const tail = expand(tailPart);
    if (!head || !tail) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    fullGroups = [...head, ...Array(missing).fill('0'), ...tail];
  } else {
    const expanded = expand(input);
    if (!expanded || expanded.length !== 8) return null;
    fullGroups = expanded;
  }

  return fullGroups.map((group) => Number.parseInt(group, 16));
}

/**
 * Read a response body while enforcing a streaming byte cap.
 *
 * Stops reading as soon as the accumulated size exceeds `maxBytes`, so an
 * oversized body is never fully buffered.
 *
 * @param {Response} response
 * @param {number} maxBytes
 * @param {string} source Original source string (for errors).
 * @returns {Promise<Buffer>}
 */
async function readResponseBody(response, maxBytes, source) {
  const body = response.body;
  if (!body) return Buffer.alloc(0);

  /** @type {Buffer[]} */
  const chunks = [];
  let total = 0;

  const tooLarge = () =>
    new ImageSourceError(
      'TOO_LARGE',
      `Image "${shortSource(source)}" exceeds maxBytes=${formatLimit(maxBytes)} while downloading (streaming size limit hit). Resize/compress the image or raise the configured limit.`,
      { source },
    );

  if (typeof body.getReader !== 'function') {
    for await (const chunk of body) {
      const buffer = Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > maxBytes) throw tooLarge();
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, total);
  }

  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const buffer = Buffer.from(value);
      total += buffer.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Ignore cancellation errors; we are already failing the download.
        }
        throw tooLarge();
      }
      chunks.push(buffer);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore: releaseLock can throw if the stream is already closed.
    }
  }

  return Buffer.concat(chunks, total);
}

/**
 * Best-effort cancellation/disposal of an unread response body.
 *
 * @param {Response} response
 * @returns {Promise<void>}
 */
async function discardResponseBody(response) {
  try {
    if (response && response.body && typeof response.body.cancel === 'function') {
      await response.body.cancel();
    }
  } catch {
    // Ignore: disposing an unused body must not mask the real error.
  }
}

/**
 * Parse a Content-Length header value.
 *
 * @param {string|null|undefined} value
 * @returns {number|null} Non-negative byte count, or null when absent/invalid.
 */
function parseContentLength(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Map a low-level fetch/body error to an ImageSourceError.
 *
 * @param {unknown} error
 * @param {string} source Original source string.
 * @param {object} opts Normalised options.
 * @param {boolean} timedOut Whether the per-download timeout fired.
 * @returns {ImageSourceError}
 */
function mapDownloadError(error, source, opts, timedOut) {
  if (error instanceof ImageSourceError) return error;

  if (opts.signal?.aborted) {
    return new ImageSourceError(
      'ABORTED',
      `Image download aborted for "${shortSource(source)}"${describeAbortReason(opts.signal.reason)}. Retry the request without aborting.`,
      { source, cause: error },
    );
  }

  if (timedOut) {
    return new ImageSourceError(
      'FETCH_FAILED',
      `Timed out after ${opts.timeoutMs}ms while downloading "${shortSource(source)}". Increase timeoutMs or use a faster/accessible image URL.`,
      { source, cause: error },
    );
  }

  const detail = error instanceof Error ? error.message : String(error);
  return new ImageSourceError(
    'FETCH_FAILED',
    `Failed to download "${shortSource(source)}": ${detail}. Check the URL, network access and that it serves an image.`,
    { source, cause: error },
  );
}

/**
 * Ensure the caller signal has not been aborted.
 *
 * @param {AbortSignal|undefined} signal
 */
function throwIfAborted(signal) {
  if (!signal || !signal.aborted) return;
  throw new ImageSourceError(
    'ABORTED',
    `Image source resolution aborted${describeAbortReason(signal.reason)}. Retry the request without aborting.`,
    signal.reason !== undefined ? { cause: signal.reason } : {},
  );
}

/**
 * Create the shared per-call temporary directory on first use.
 *
 * @param {{ tempDirPath: string|null }} state
 * @param {object} opts Normalised options.
 * @param {string} source Original source string (for errors).
 * @returns {Promise<string>} Absolute temporary directory path.
 */
async function ensureTempDir(state, opts, source) {
  if (state.tempDirPath) return state.tempDirPath;
  try {
    state.tempDirPath = await fs.mkdtemp(
      path.join(opts.tempDir, 'dsh-codex-vision-'),
    );
  } catch (cause) {
    throw new ImageSourceError(
      'INVALID_ARGUMENT',
      `Failed to create a temporary directory under "${opts.tempDir}" for "${shortSource(source)}": ${cause instanceof Error ? cause.message : String(cause)}. Check options.tempDir permissions and free disk space.`,
      { source, cause },
    );
  }
  return state.tempDirPath;
}

/**
 * Write image bytes to a uniquely named file in the shared temporary directory.
 *
 * @param {Uint8Array} bytes
 * @param {string} mediaType
 * @param {number} index Position within the sources array.
 * @param {object} opts Normalised options.
 * @param {{ tempDirPath: string|null }} state
 * @param {string} source Original source string (for errors).
 * @returns {Promise<string>} Absolute path of the written file.
 */
async function writeTemporaryImage(bytes, mediaType, index, opts, state, source) {
  const dir = await ensureTempDir(state, opts, source);
  const digest = createHash('sha256')
    .update(bytes)
    .digest('hex')
    .slice(0, 32);
  const extension = MEDIA_TYPE_EXTENSIONS[mediaType] ?? '.img';
  const filePath = path.join(dir, `${index}-${digest}${extension}`);

  try {
    await fs.writeFile(filePath, bytes);
  } catch (cause) {
    throw new ImageSourceError(
      'INVALID_ARGUMENT',
      `Failed to write the temporary image file for "${shortSource(source)}" in "${dir}": ${cause instanceof Error ? cause.message : String(cause)}. Check options.tempDir, permissions and free disk space.`,
      { source, cause },
    );
  }

  return filePath;
}

/**
 * Describe an abort reason for error messages.
 *
 * @param {unknown} reason
 * @returns {string} Empty string or ": <reason>".
 */
function describeAbortReason(reason) {
  if (reason == null) return '';
  if (typeof reason === 'string') return `: ${reason}`;
  if (reason instanceof Error && reason.message) {
    return `: ${reason.message}`;
  }
  return '';
}

/**
 * Shorten a source for inclusion in error messages.
 *
 * @param {string} source
 * @returns {string} Source, truncated if very long.
 */
function shortSource(source) {
  const text = String(source);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

/**
 * Describe the type of an arbitrary value for validation messages.
 *
 * @param {unknown} value
 * @returns {string}
 */
function describeValueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a value of type ${typeof value}`;
}

/**
 * Format a numeric limit for messages.
 *
 * @param {number} limit
 * @returns {string}
 */
function formatLimit(limit) {
  return limit === Infinity ? 'unlimited' : String(limit);
}
