import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const manifestUrl = new URL('../src/manifest.json', import.meta.url)
const popupUrl = new URL('../src/popup/components/app.svelte', import.meta.url)

test('directory viewer is opened from the popup', async () => {
  const [manifestSource, popupSource] = await Promise.all([
    readFile(manifestUrl, 'utf8'),
    readFile(popupUrl, 'utf8'),
  ])
  const manifest = JSON.parse(manifestSource)
  const viewerMatch = popupSource.match(
    /chrome\.runtime\.getURL\(['"]([^'"]+)['"]\)/,
  )

  assert.ok(
    viewerMatch,
    'expected popup to open viewer.html via chrome.runtime.getURL',
  )

  const viewerPath = viewerMatch[1].split(/[?#]/, 1)[0]
  assert.equal(viewerPath, 'viewer.html', 'expected viewer.html as target')

  // viewer.html must be web-accessible for the directory download-redirect
  // flow (background.ts opens viewer.html from a service worker context).
  const viewerResource = manifest.web_accessible_resources.find(entry =>
    entry.resources.includes(viewerPath),
  )

  assert.ok(viewerResource, `${viewerPath} must be web-accessible`)
})
