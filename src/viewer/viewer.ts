import throttle from 'lodash.throttle'
import Event from '@/core/event'
import Ele, { svg } from '@/core/ele'
import { initPlugins } from '@/plugins'
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
import DirectoryTree from '@/core/directory-tree'
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

async function main() {
  const configData = getDefaultData()

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

  // ——— directory tree ———

  const dirtreeContainer = new Ele<HTMLElement>('div', {
    className: className.TAB_DIRTREE,
  })

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

  const showBinary = (handle: FileSystemFileHandle, name: string) => {
    currentMarkdown = null
    rawMode = false
    rawContent.hide()
    mdContent.show()
    previewBinary(handle, name, mdContent, mdSideList)
  }

  const tree = new DirectoryTree({
    root: dirtreeContainer.ele,
    onOpenMdFile: swapContent,
    onOpenBinaryFile: showBinary,
    onUrlChange: (path: string) => setHashPath(path),
    onPick: () => {
      const path = getHashPath()
      if (path) void tree.navigateTo(path)
    },
  })

  sidebarTabs.addTab('dirtree', '目录树', dirtreeContainer.ele)

  // handle initial hash
  const initialPath = getHashPath()
  if (initialPath) {
    await tree.ready
    await tree.navigateTo(initialPath)
  }

  // listen for hash changes (browser back/forward, manual URL edit)
  window.addEventListener('hashchange', () => {
    const path = getHashPath()
    if (path) void tree.navigateTo(path)
  })

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

  const buttonWrap = new Ele<HTMLElement>(
    'div',
    { className: className.BUTTON_WRAP_ELE },
    [sideExpandBtn, rawToggleBtn, goTopBtn],
  )
  mdBody.append(buttonWrap)

  // ——— mount ———

  document.body.appendChild(mdBody.ele)
  document.body.appendChild(sidebarTabs.element)

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
