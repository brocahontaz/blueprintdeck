import { deflateRaw } from 'pako';
import { parseBlueprintDocument, type BlueprintDocument } from './decode';

/**
 * Factorio blueprint string encoding, the inverse of decode.ts:
 * '0' + base64url(raw DEFLATE(JSON)).
 *
 * The input is validated through the same normalizers used for decoding (via
 * {@link parseBlueprintDocument}), but the serialized document keeps the
 * original value untouched, so unknown JSON fields survive losslessly.
 *
 * See https://wiki.factorio.com/Blueprint_string_format
 */

/**
 * Base64url-encode bytes without Node's Buffer: build the binary string in
 * chunks (btoa is fine in browsers and the Node test environment), then map
 * to the URL-safe alphabet and strip padding.
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function encodeDocument(document: BlueprintDocument): string {
  const json = JSON.stringify(document);
  const bytes = new TextEncoder().encode(json);
  return `0${bytesToBase64Url(deflateRaw(bytes))}`;
}

/**
 * Encode a single blueprint page (the value of Factorio's `blueprint` field)
 * as a blueprint string. The page is validated with the existing decode
 * normalizers; on success the ORIGINAL page value is serialized, preserving
 * unknown fields. The input is never mutated or reordered.
 *
 * Throws {@link BlueprintDecodeError} when the page is not a valid blueprint.
 */
export function encodeBlueprintPage(page: unknown): string {
  const decoded = parseBlueprintDocument({ blueprint: page });
  return encodeDocument(decoded.raw);
}

/**
 * Encode a blueprint book (the value of Factorio's `blueprint_book` field)
 * as a blueprint string, with the same validation and lossless behavior as
 * {@link encodeBlueprintPage}.
 *
 * Throws {@link BlueprintDecodeError} when the value is not a valid book.
 */
export function encodeBlueprintBook(book: unknown): string {
  const decoded = parseBlueprintDocument({ blueprint_book: book });
  return encodeDocument(decoded.raw);
}
