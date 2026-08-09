const ABSOLUTE_IMAGE_URL_RE = /^(?:[a-z][a-z\d+.-]*:|\/|#)/i

export const TRANSPARENT_IMAGE_PLACEHOLDER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/**
 * Preserve relative image paths before the extension page resolves them via
 * File System Access handles. Replacing src synchronously also prevents the
 * browser from requesting the path against the chrome-extension:// origin.
 */
export function prepareRelativeImages(container: ParentNode): void {
  for (const img of Array.from(
    container.querySelectorAll<HTMLImageElement>('img[src]'),
  )) {
    const src = img.getAttribute('src')
    if (!src || ABSOLUTE_IMAGE_URL_RE.test(src)) continue

    img.setAttribute('data-rel-src', src)
    img.src = TRANSPARENT_IMAGE_PLACEHOLDER
  }
}
