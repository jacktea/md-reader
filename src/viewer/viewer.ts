import throttle from 'lodash.throttle'
import Event from '@/core/event'
import storage from '@/core/storage'
import Ele, { svg } from '@/core/ele'
import { initPlugins } from '@/plugins'
import { findBinaryConverter } from '@/core/converters'
import className from '@/config/class-name'
import type { Theme } from '@/config/page-themes'
import { getDefaultData, type Data } from '@/core/data'
import { mdRender, type MdOptions } from '@/core/markdown'
import {
  getHeads,
  setTheme,
  darkMediaQuery,
  getMediaQueryTheme,
  toTheme,
} from '@/shared'
import codeIcon from '@/images/icon_code.svg'
import sideIcon from '@/images/icon_side.svg'
import goTopIcon from '@/images/icon_go_top.svg'
import '@/style/index.less'

// Local file directory tree
import SidebarTabs from '@/core/sidebar-tabs'
import DirectoryTree, {
  loadFileHandle,
  clearFileHandle,
  storeFileHandle,
  storeRootHandle,
} from '@/core/directory-tree'
import { prepareRelativeImages } from '@/core/local-images'

// Mermaid async rendering
import { renderDiagrams } from '@/core/mermaid'

// ——— helpers ———

function getHashPath(): string {
  const hash = window.location.hash.replace(/^#/, '')
  return hash.startsWith('/') ? hash.slice(1) : hash
}

function setHashPath(path: string): void {
  window.history.replaceState(null, '', `#/${path}`)
}

// ——— binary preview ———

const IMG_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'])

function previewBinary(
  handle: FileSystemFileHandle,
  name: string,
  mdContent: Ele<HTMLElement>,
  mdSideList: Ele<HTMLElement>,
): void {
  void handle.getFile().then(file => {
    const objectUrl = URL.createObjectURL(file)
    const ext = name.split('.').pop()?.toLowerCase()
    if (ext && IMG_EXTS.has(ext)) {
      mdContent.innerHTML = `<div class="${className.MD_CONTENT}"><img src="${objectUrl}" alt="${name}" style="max-width:100%;display:block;margin:0 auto" /></div>`
    } else if (ext === 'pdf') {
      mdContent.innerHTML = `<iframe src="${objectUrl}" style="width:100%;height:90vh;border:none"></iframe>`
    } else {
      mdContent.innerHTML = `<div class="${className.MD_CONTENT}"><p style="text-align:center;padding:40px;color:var(--color-text-gray)">无法预览此文件类型: ${name}</p></div>`
    }
    mdSideList.innerHTML = ''
  })
}

// ——— main ———

const MD_RE = /\.(md|mdx|mkd|markdown)$/i

function isMarkdownFile(name: string): boolean {
  return MD_RE.test(name)
}

/** Render a single file handle (from the popup) in the viewer. */
async function renderFileHandle(
  handle: FileSystemFileHandle,
  swapContent: (content: string, name: string) => HTMLElement,
  showBinary: (handle: FileSystemFileHandle, name: string) => void,
): Promise<void> {
  const name = handle.name
  if (isMarkdownFile(name)) {
    const file = await handle.getFile()
    const content = await file.text()
    swapContent(content, name)
  } else {
    await showBinary(handle, name)
  }
}

async function main() {
  const configData = getDefaultData()
  const stored = await storage.get('anydocEnabled')
  if (stored.anydocEnabled !== undefined) {
    configData.anydocEnabled = stored.anydocEnabled
  }

  let globalEvent = new Event()
  initPlugins({ event: globalEvent })

  // render mermaid diagrams after every content render
  globalEvent.on('contentRendered', (container: HTMLElement) => {
    void renderDiagrams(container)
  })

  setTheme(configData.pageTheme)
  document.body.classList.add('md-reader')

  // ——— content area ———

  const mdContent = new Ele<HTMLElement>('article', {
    className: `${className.MD_CONTENT} centered`,
  })
  mdContent.on(
    'click',
    e => {
      globalEvent.emit('click', e.target)
    },
    true,
  )

  const rawContent = new Ele<HTMLElement>('pre', {
    className: `${className.MD_CONTENT} centered`,
  })
  rawContent.hide()
  let currentMarkdown: string | null = null
  let rawMode = false

  function toggleRawContent(): void {
    if (currentMarkdown === null) return
    rawMode = !rawMode
    mdContent.toggle(!rawMode)
    rawContent.toggle(rawMode)
  }

  const mdBody = new Ele<HTMLElement>('main', {
    className: className.MD_BODY,
  })
  mdBody.append([mdContent, rawContent])

  // onScroll can run while the initial file is being restored, before the
  // rest of main() resumes after awaiting File System Access operations.
  const goTopBtn = new Ele<HTMLElement>(
    'button',
    {
      className: [className.MD_BUTTON, className.GO_TOP_BTN],
      title: 'Go top',
    },
    svg(goTopIcon),
  )
  goTopBtn.hide()
  goTopBtn.on('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }))

  // ——— outline ———

  const mdSideList = new Ele<HTMLElement>('ul', {
    className: className.MD_SIDE,
  })

  let idCache: { [content: string]: number } = Object.create(null)
  let headElements: HTMLElement[] = []
  let sideLiElements: HTMLElement[] = []
  let targetIndex: number = null
  let df: Ele<DocumentFragment> = null
  let isSideHover: boolean = false

  mdSideList.on('mouseenter', () => {
    isSideHover = true
  })
  mdSideList.on('mouseleave', () => {
    isSideHover = false
  })

  function renderSide() {
    idCache = Object.create(null)
    headElements = getHeads(mdContent)
    df = new Ele<DocumentFragment>('#document-fragment')
    sideLiElements = headElements.reduce(handleHeadItem, [])
    mdSideList.innerHTML = null
    mdSideList.append(df)
    setTimeout(onScroll, 0)
  }

  function handleHeadItem(
    eleList: HTMLElement[],
    head: HTMLElement,
  ): HTMLElement[] {
    const content = String(head.textContent).trim()
    const encodeContent = getDecodeContent(content)

    head.setAttribute('id', encodeContent)

    const headAnchor = new Ele<HTMLElement>('a', {
      className: className.HEAD_ANCHOR,
      href: `#${encodeContent}`,
    })
    headAnchor.textContent = '#'
    head.insertBefore(headAnchor.ele, head.firstChild)

    const link = new Ele<HTMLElement>('a', {
      title: content,
      href: `#${encodeContent}`,
    })
    link.textContent = content
    const li = new Ele<HTMLElement>('li', {
      className: `${className.MD_SIDE}-${head.tagName.toLowerCase()}`,
    })
    eleList.push(li.ele)
    li.append(link)
    df.append(li.ele)

    return eleList
  }

  function getDecodeContent(content: string): string {
    return (function unique(key: string): string {
      if (key in idCache) {
        return unique(`${key}-${idCache[key]++}`)
      } else {
        idCache[key] = 1
        return key
      }
    })(encodeURIComponent(content.toLowerCase().replace(/\s+/g, '-')))
  }

  function onScroll() {
    const documentScrollTop = document.documentElement.scrollTop
    goTopBtn.toggle(documentScrollTop >= 640)

    headElements.some((_, index) => {
      let sectionHeight = -20
      const item = headElements[index + 1]
      if (item) {
        sectionHeight += item.offsetTop
      }

      const hit = sectionHeight <= 0 || sectionHeight > documentScrollTop

      if (hit && targetIndex !== index) {
        let target = sideLiElements[targetIndex]
        target && target.classList.remove(className.MD_SIDE_ACTIVE)

        target = sideLiElements[(targetIndex = index)]
        if (target) {
          target.classList.add(className.MD_SIDE_ACTIVE)
          if (!isSideHover && target.scrollIntoView) {
            target.scrollIntoView({ block: 'nearest' })
          }
        }
      }
      return hit
    })
  }

  document.addEventListener('scroll', throttle(onScroll, 100))

  // ——— sidebar tabs ———

  const sidebarTabs = new SidebarTabs({
    outlineList: mdSideList.ele,
    currentUrl: window.location.href,
  })

  // ——— markdown renderer ———

  const mdRenderer =
    (target: HTMLElement | Ele) =>
    (code: string = '', options?: MdOptions) => {
      target.innerHTML = mdRender(code, {
        theme: toTheme(configData.pageTheme),
        plugins: configData.mdPlugins,
        ...options,
      })
      globalEvent.emit(
        'contentRendered',
        target instanceof Ele ? target.ele : target,
      )
    }
  const contentRender = mdRenderer(mdContent)

  // ——— content / binary renderers ———
  // swapContent, tryConvertAndRender, showBinary, previewRemoteFile are
  // shared by the directory tree and single-file (file mode) rendering.

  const swapContent = (content: string, _name: string) => {
    currentMarkdown = content
    rawContent.textContent = content
    contentRender(content)
    prepareRelativeImages(mdContent.ele)
    mdContent.toggle(!rawMode)
    rawContent.toggle(rawMode)
    renderSide()
    return mdContent.ele
  }

  /**
   * Try to convert a binary file (anydoc office/epub) and render the result.
   * Returns false when no converter applies or conversion fails, so the
   * caller can fall back.
   */
  const tryConvertAndRender = async (
    file: File,
    name: string,
  ): Promise<boolean> => {
    const converter =
      configData.anydocEnabled !== false ? findBinaryConverter(name) : null
    if (!converter) return false

    mdContent.innerHTML = `<div class="${className.MD_CONTENT}"><p style="text-align:center;padding:40px;color:var(--color-text-gray)">正在转换: ${name}…</p></div>`
    mdSideList.innerHTML = ''
    try {
      const result = await converter.convert(file, name)
      if (!result) return false
      currentMarkdown = result.markdown
      rawContent.textContent = result.markdown
      contentRender(result.markdown)
      mdContent.toggle(!rawMode)
      rawContent.toggle(rawMode)
      renderSide()
      return true
    } catch (err) {
      console.error(`[anydoc] preview failed for ${name}:`, err)
      return false
    }
  }

  const showBinary = async (handle: FileSystemFileHandle, name: string) => {
    currentMarkdown = null
    rawMode = false
    rawContent.hide()
    mdContent.show()

    const file = await handle.getFile()
    const converted = await tryConvertAndRender(file, name)
    if (!converted) {
      previewBinary(handle, name, mdContent, mdSideList)
    }
  }

  // ——— remote file preview ———
  //
  // The service worker redirects main-frame navigations to office/epub URLs
  // into `viewer.html#remote=<url>` (declarativeNetRequest). Here we fetch
  // the original URL and run it through the same anydoc pipeline. With
  // host_permissions the fetch is exempt from CORS; credentials are sent so
  // files behind a login still load when the site's cookies are present.
  const previewRemoteFile = async (rawUrl: string) => {
    let url: string
    try {
      url = decodeURIComponent(rawUrl)
    } catch {
      url = rawUrl
    }
    const name =
      decodeURIComponent(
        url.split('?')[0].split('/').pop() || 'document.docx',
      ) || 'document.docx'

    currentMarkdown = null
    rawMode = false
    rawContent.hide()
    mdContent.show()
    mdContent.innerHTML = `<div class="${className.MD_CONTENT}"><p style="text-align:center;padding:40px;color:var(--color-text-gray)">正在加载: ${name}…</p></div>`
    mdSideList.innerHTML = ''

    try {
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const bytes = await res.arrayBuffer()
      const file = new File([bytes], name, {
        type: res.headers.get('content-type') ?? '',
      })
      const converted = await tryConvertAndRender(file, name)
      if (!converted) throw new Error('unsupported file type')
    } catch (err) {
      console.error(`[anydoc] remote preview failed for ${url}:`, err)
      mdContent.innerHTML = `<div class="${className.MD_CONTENT}"><p style="text-align:center;padding:40px;color:var(--color-text-gray)">无法预览此文件: ${name}<br/><a href="${url}" style="color:var(--color-link,#576b95)">在浏览器中打开</a></p></div>`
      mdSideList.innerHTML = ''
    }
  }

  // ——— mode detection: single file preview vs directory tree ———
  // A file handle stored by the popup renders directly (file mode); otherwise
  // we show a center choose screen. The sidebar is hidden until the user
  // picks a file or directory.
  let isFileMode = false
  let dirtreeContainer: Ele<HTMLElement> | null = null
  let tree: DirectoryTree | null = null
  const pendingFile = await loadFileHandle()

  // Hide the sidebar initially; we'll show it when a file/directory is opened.
  sidebarTabs.element.style.display = 'none'
  mdBody.setStyle({ paddingLeft: '0' })

  /** Show the sidebar and restore body padding. */
  const showSidebar = () => {
    sidebarTabs.element.style.display = ''
    mdBody.setStyle({ paddingLeft: '' })
  }

  /** Switch to directory mode: create directory tree, add dirtree tab. */
  const activateDirectoryMode = () => {
    if (dirtreeContainer) return // already in directory mode
    isFileMode = false
    showSidebar()
    dirtreeContainer = new Ele<HTMLElement>('div', {
      className: className.TAB_DIRTREE,
    })
    tree = new DirectoryTree({
      root: dirtreeContainer.ele,
      onOpenMdFile: swapContent,
      onOpenBinaryFile: showBinary,
      onUrlChange: (path: string) => setHashPath(path),
      onPick: () => {
        const path = getHashPath()
        if (path) void tree!.navigateTo(path)
      },
    })
    sidebarTabs.addTab('dirtree', '目录树', dirtreeContainer.ele)
    sidebarTabs.activateTab('dirtree')
    // listen for hash changes (browser back/forward, manual URL edit)
    window.addEventListener('hashchange', () => {
      const path = getHashPath()
      if (path) void tree!.navigateTo(path)
    })
  }

  if (pendingFile) {
    // File mode, from popup
    isFileMode = true
    showSidebar()
    await clearFileHandle()
    await renderFileHandle(pendingFile, swapContent, showBinary)
  } else {
    // Center choose screen (no sidebar until user picks)
    const chooseScreen = new Ele<HTMLElement>('div', {
      className: 'dirtree-hint',
      style:
        'position:absolute;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:40px',
    })
    const hint = new Ele<HTMLElement>('p', {
      style: 'margin:0;font-size:14px;color:var(--color-text-gray)',
    })
    hint.textContent = '请选择要预览的文件或目录'
    chooseScreen.append(hint)

    const fileBtn = new Ele<HTMLElement>('button', {
      className: className.DIRTREE_PICK_BTN,
    })
    fileBtn.textContent = '打开文件'
    fileBtn.on('click', () => {
      void (async () => {
        try {
          const [handle] = await window.showOpenFilePicker()
          await storeFileHandle(handle)
          isFileMode = true
          showSidebar()
          await clearFileHandle()
          await renderFileHandle(handle, swapContent, showBinary)
          chooseScreen.hide()
          dirOpenBtn.show()
        } catch (err) {
          if ((err as Error).name !== 'AbortError') {
            console.error('File pick failed:', err)
          }
        }
      })()
    })
    chooseScreen.append(fileBtn)

    const dirBtn = new Ele<HTMLElement>('button', {
      className: className.DIRTREE_PICK_BTN,
      style: 'margin-top:0',
    })
    dirBtn.textContent = '打开目录'
    dirBtn.on('click', () => {
      void (async () => {
        try {
          const handle = await window.showDirectoryPicker()
          await storeRootHandle(handle)
          chooseScreen.hide()
          activateDirectoryMode()
        } catch (err) {
          if ((err as Error).name !== 'AbortError') {
            console.error('Directory pick failed:', err)
          }
        }
      })()
    })
    chooseScreen.append(dirBtn)

    mdBody.ele.insertBefore(chooseScreen.ele, mdBody.ele.firstChild)
  }

  // ——— buttons ———

  /* raw toggle button */
  const rawToggleBtn = new Ele<HTMLElement>(
    'button',
    {
      className: [className.MD_BUTTON, className.CODE_TOGGLE_BTN],
      title: 'Toggle raw',
    },
    svg(codeIcon),
  )
  rawToggleBtn.on('click', toggleRawContent)

  /* side expand button */
  const sideExpandBtn = new Ele<HTMLElement>(
    'button',
    {
      className: [className.MD_BUTTON, className.SIDE_EXPAND_BTN],
      title: 'Expand side',
    },
    svg(sideIcon),
  )
  sideExpandBtn.on('click', () => {
    document.body.classList.toggle('side-collapsed')
  })

  /* directory open button: switches file mode → directory mode */
  const dirOpenBtn = new Ele<HTMLElement>('button', {
    className: [className.MD_BUTTON, className.DIR_OPEN_BTN],
    title: '打开目录',
  })
  dirOpenBtn.textContent = '📂'
  dirOpenBtn.hide()

  dirOpenBtn.on('click', () => {
    void (async () => {
      try {
        const handle = await window.showDirectoryPicker()
        await storeRootHandle(handle)
        activateDirectoryMode()
        dirOpenBtn.hide()
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('Directory pick failed:', err)
        }
      }
    })()
  })
  // Show the directory button only in file mode (single-file preview)
  if (isFileMode) dirOpenBtn.show()

  const buttonWrap = new Ele<HTMLElement>(
    'div',
    { className: className.BUTTON_WRAP_ELE },
    [sideExpandBtn, rawToggleBtn, dirOpenBtn, goTopBtn],
  )
  mdBody.append(buttonWrap)

  // ——— mount ———

  document.body.appendChild(mdBody.ele)
  document.body.appendChild(sidebarTabs.element)

  // remote file redirect target: viewer.html#remote=<url>
  const remoteMatch = window.location.hash.match(/^#remote=(.+)$/)
  if (remoteMatch) {
    void previewRemoteFile(remoteMatch[1])
  }

  // ——— drag & drop preview ———
  //
  // Dropping a file into the browser chrome (tab strip / new tab) makes
  // Chrome navigate to file://… and download office/epub files before any
  // extension code can run. Dropping *into this page* instead hands the
  // page a real `File` object (no extra permission needed), which feeds the
  // same anydoc pipeline as the directory tree.
  let dragDepth = 0
  document.addEventListener('dragenter', e => {
    e.preventDefault()
    dragDepth += 1
  })
  document.addEventListener('dragover', e => e.preventDefault())
  document.addEventListener('dragleave', e => {
    dragDepth = Math.max(0, dragDepth - 1)
  })
  document.addEventListener('drop', e => {
    e.preventDefault()
    dragDepth = 0
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    currentMarkdown = null
    rawMode = false
    rawContent.hide()
    mdContent.show()
    void tryConvertAndRender(file, file.name).then(converted => {
      if (converted) return
      const objectUrl = URL.createObjectURL(file)
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (ext && IMG_EXTS.has(ext)) {
        mdContent.innerHTML = `<div class="${className.MD_CONTENT}"><img src="${objectUrl}" alt="${file.name}" style="max-width:100%;display:block;margin:0 auto" /></div>`
      } else if (ext === 'pdf') {
        mdContent.innerHTML = `<iframe src="${objectUrl}" style="width:100%;height:90vh;border:none"></iframe>`
      } else {
        mdContent.innerHTML = `<div class="${className.MD_CONTENT}"><p style="text-align:center;padding:40px;color:var(--color-text-gray)">无法预览此文件类型: ${file.name}</p></div>`
      }
      mdSideList.innerHTML = ''
    })
  })

  // ——— theme change listener ———

  darkMediaQuery.addEventListener('change', (e: MediaQueryListEvent) => {
    if (configData.pageTheme === 'auto') {
      const from = e.matches ? 'light' : 'dark'
      const to = e.matches ? 'dark' : 'light'
      if (configData.mdPlugins.includes('Mermaid')) {
        // triggers mermaid re-render by toggling theme
        contentRender('')
      }
    }
  })
}

// ——— start ———

void main()
