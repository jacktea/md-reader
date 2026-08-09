import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const manifestUrl = new URL('../src/manifest.json', import.meta.url)
const contentScriptUrl = new URL('../src/main.ts', import.meta.url)

test('directory viewer opened from a local file is web-accessible', async () => {
  const [manifestSource, contentScript] = await Promise.all([
    readFile(manifestUrl, 'utf8'),
    readFile(contentScriptUrl, 'utf8'),
  ])
  const manifest = JSON.parse(manifestSource)
  const viewerMatch = contentScript.match(
    /chrome\.runtime\.getURL\(['"]([^'"]+)['"]\)/,
  )

  assert.ok(
    viewerMatch,
    'expected the directory button to open an extension page',
  )

  const viewerPath = viewerMatch[1].split(/[?#]/, 1)[0]
  const viewerResource = manifest.web_accessible_resources.find(entry =>
    entry.resources.includes(viewerPath),
  )

  assert.ok(
    viewerResource,
    `${viewerPath} must be web-accessible before a file:// page can navigate to it`,
  )
  assert.ok(
    viewerResource.matches.some(
      pattern => pattern === '<all_urls>' || pattern.startsWith('file://'),
    ),
    `${viewerPath} must be web-accessible to file:// pages`,
  )
})
