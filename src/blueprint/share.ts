/**
 * Shareable result URLs: '#bp=<blueprint string>' optionally with
 * '&sel=<book page index>'. Everything lives in the URL hash — no backend,
 * no storage, nothing leaves the browser.
 */

export interface ShareParts {
  bp: string | null;
  sel: number | null;
}

/** Build the URL hash for a decoded blueprint string. */
export function buildShareHash(bp: string, bookIndex?: number | null): string {
  const parts = [`bp=${bp}`];
  if (typeof bookIndex === 'number' && Number.isFinite(bookIndex) && bookIndex >= 0) {
    parts.push(`sel=${Math.trunc(bookIndex)}`);
  }
  return `#${parts.join('&')}`;
}

/** Parse a location hash ('#bp=…&sel=…') into its parts. */
export function parseShareHash(hash: string): ShareParts {
  if (!hash) return { bp: null, sel: null };
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  let bp: string | null = null;
  let sel: number | null = null;
  for (const segment of text.split('&')) {
    const equals = segment.indexOf('=');
    if (equals < 0) continue;
    const key = segment.slice(0, equals);
    const value = segment.slice(equals + 1);
    if (key === 'bp' && bp === null && value !== '') {
      bp = value;
    } else if (key === 'sel' && sel === null) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isInteger(parsed) && parsed >= 0) sel = parsed;
    }
  }
  return { bp, sel };
}

/**
 * Swap the current URL hash without adding a history entry. No-op outside a
 * browser (e.g. under the node test environment).
 */
export function replaceHash(hash: string): void {
  if (typeof window === 'undefined' || typeof window.history?.replaceState !== 'function') {
    return;
  }
  try {
    if (hash) {
      window.history.replaceState(null, '', hash);
    } else {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  } catch {
    // Some environments (sandboxed iframes, odd protocols) throw here;
    // the app still works without hash syncing.
  }
}

/**
 * Copy text to the clipboard: async Clipboard API first, then a hidden
 * textarea + execCommand fallback for non-secure contexts. Returns whether
 * the copy succeeded.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the execCommand fallback.
    }
  }
  if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
    try {
      const helper = document.createElement('textarea');
      helper.value = text;
      helper.setAttribute('readonly', '');
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.append(helper);
      helper.select();
      const copied = document.execCommand('copy');
      helper.remove();
      return copied;
    } catch {
      return false;
    }
  }
  return false;
}
