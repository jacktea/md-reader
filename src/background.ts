import storage from '@/core/storage'
import commands from '@/core/commands'

// Remote office/epub preview, MIME-based.
//
// Chrome decides to download a remote file from its response MIME, so the
// download event *is* the MIME signal: `chrome.downloads.onCreated` fires
// with the real Content-Type (and covers `Content-Disposition: attachment`
// and extension-less URLs that URL matching could never see). We cancel the
// download and hand the original URL to the viewer, which fetches the bytes
// itself and renders them through the anydoc converter.
//
// In-page previews (an app that loads the file via fetch/XHR/iframe to
// render it itself) never create a download, so they are never intercepted.
const OFFICE_MIME_RE =
  /^(application\/(msword|vnd\.openxmlformats-officedocument\.(wordprocessingml|presentationml|spreadsheetml)|vnd\.ms-(word|powerpoint|excel)|vnd\.oasis\.opendocument\.(text|spreadsheet|presentation)|rtf|epub\+zip|csv)|text\/(rtf|csv))/i

// Chrome can fire onCreated twice for the same main-frame download (the
// cancel retries the URL); a short time window dedupes that while still
// letting a later, deliberate re-download of the same file through.
const recentRemote = new Map<string, number>()
const DEDUPE_MS = 10_000

chrome.downloads.onCreated.addListener(item => {
  if (!item.url.startsWith('http')) return
  if (!OFFICE_MIME_RE.test(item.mime || '')) return
  void (async () => {
    // Respect the user's "Office/EPUB Preview" toggle in the popup.
    const { anydocEnabled } = await chrome.storage.local.get('anydocEnabled')
    if (anydocEnabled === false) return

    const now = Date.now()
    const last = recentRemote.get(item.url)
    if (last !== undefined && now - last < DEDUPE_MS) return
    recentRemote.set(item.url, now)

    try {
      await chrome.downloads.cancel(item.id)
      await chrome.downloads.erase({ id: item.id })
    } catch (err) {
      // The download already finished (too fast to cancel); nothing to
      // preview from a fetch, so leave the downloaded file alone.
      return
    }
    const url = `${chrome.runtime.getURL(
      'viewer.html',
    )}#remote=${encodeURIComponent(item.url)}`
    void chrome.tabs.create({ url })
  })()
})

chrome.runtime.onMessage.addListener(({ action, data }, sender, callback) => {
  messageHandler(action, data, sender, callback)
  return true
})

async function messageHandler(
  action: string,
  data: any,
  sender: chrome.runtime.MessageSender,
  callback?: (response?: any) => void,
) {
  switch (action) {
    case 'storage':
      await storage.set({ [data.key]: data.value })
      updatePage(data.key, data.value)
      callback?.(data)
      break
    case 'fetch':
      fetchData(sender.url).then(callback)
      break
  }
}

async function fetchData(url?: string) {
  if (!url) {
    const error = new Error('Fetch error: URL is undefined.')
    console.error(error)
    return error.message
  }

  return fetch(url)
    .then(res => res.text())
    .catch(err => {
      console.error(err)
      return err.message
    })
}

// Chrome extension shortcuts
chrome.commands.onCommand.addListener(action => {
  commands[action]?.(messageHandler)
})

const actionMap = {
  enable: 'reload',
  refresh: 'toggleRefresh',
  centered: 'toggleCentered',
  mdPlugins: 'updateMdPlugins',
  pageTheme: 'updatePageTheme',
  hiddenSide: 'toggleSide',
  anydocEnabled: 'reload',
}

function updatePage(key: keyof typeof actionMap, value?: any) {
  const action = actionMap[key]
  action &&
    chrome.tabs.query({ currentWindow: true, active: true }, tabs => {
      tabs.length &&
        chrome.tabs.sendMessage(tabs[0].id, { action, data: { key, value } })
    })
}

chrome.runtime.setUninstallURL(
  'https://github.com/orgs/md-reader/discussions/51',
)
