import Ele from '@/core/ele'
import className from '@/config/class-name'

const DB_NAME = 'md-reader-dir'
const DB_STORE = 'handles'
const ROOT_KEY = 'root'

interface DirEntry {
  name: string
  handle: FileSystemFileHandle | FileSystemDirectoryHandle
  type: 'file' | 'directory'
  expanded: boolean
  children: DirEntry[]
}

export interface DirectoryTreeOptions {
  /** container element to render into */
  root: HTMLElement
  /** callback when a markdown file is opened; returns the rendered element */
  onOpenMdFile: (content: string, name: string) => HTMLElement
  /** callback when a non-markdown file is opened */
  onOpenBinaryFile: (handle: FileSystemFileHandle, name: string) => void
}

const MD_RE = /\.(md|mdx|mkd|markdown)$/i

function isMarkdown(name: string): boolean {
  return MD_RE.test(name)
}

const ABSOLUTE_URL_RE = /^(https?:|data:|blob:|file:|mailto:|#)/i

function isAbsoluteUrl(url: string): boolean {
  return ABSOLUTE_URL_RE.test(url)
}

/**
 * Resolve a relative path (as found in markdown img/a href) against the
 * current directory path stack. Returns the target handle plus the path
 * stack of the target's directory, or null if unresolvable.
 */
async function resolveRelative(
  relativePath: string,
  path: FileSystemDirectoryHandle[],
): Promise<{
  handle: FileSystemHandle
  path: FileSystemDirectoryHandle[]
} | null> {
  const parts = relativePath.split('/').filter(p => p && p !== '.')
  const dirs = [...path]

  for (const part of parts) {
    if (part === '..') {
      if (dirs.length <= 1) {
        console.warn('[dirtree] resolveRelative: cannot go above root', {
          relativePath,
          pathDepth: path.length,
        })
        return null
      }
      dirs.pop()
      continue
    }
    const current = dirs[dirs.length - 1]
    try {
      const sub = await current.getDirectoryHandle(part)
      dirs.push(sub)
    } catch {
      try {
        const file = await current.getFileHandle(part)
        return { handle: file, path: dirs }
      } catch {
        console.warn('[dirtree] resolveRelative: not found', {
          relativePath,
          part,
          pathDepth: path.length,
        })
        return null
      }
    }
  }
  return null
}

function openIndexedDB(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function storeRootHandle(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const db = await openIndexedDB()
  const tx = db.transaction(DB_STORE, 'readwrite')
  tx.objectStore(DB_STORE).put(handle, ROOT_KEY)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function loadRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openIndexedDB()
  const tx = db.transaction(DB_STORE, 'readonly')
  const getReq = tx.objectStore(DB_STORE).get(ROOT_KEY)
  const handle = await new Promise<FileSystemDirectoryHandle | null>(
    (resolve, reject) => {
      getReq.onsuccess = () => resolve(getReq.result || null)
      getReq.onerror = () => reject(getReq.error)
    },
  )
  db.close()
  return handle
}

async function readDirectory(
  handle: FileSystemDirectoryHandle,
): Promise<DirEntry[]> {
  const entries: DirEntry[] = []
  for await (const raw of handle.values()) {
    const entry = raw as FileSystemFileHandle | FileSystemDirectoryHandle
    entries.push({
      name: entry.name,
      handle: entry,
      type: entry.kind,
      expanded: false,
      children: [],
    })
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return entries
}

// map from DOM element to DirEntry for event delegation lookups
const entryMap = new WeakMap<HTMLElement, DirEntry>()

export default class DirectoryTree {
  private root: HTMLElement
  private onOpenMdFile: DirectoryTreeOptions['onOpenMdFile']
  private onOpenBinaryFile: DirectoryTreeOptions['onOpenBinaryFile']
  private path: FileSystemDirectoryHandle[] = []
  private entries: DirEntry[] = []

  constructor({ root, onOpenMdFile, onOpenBinaryFile }: DirectoryTreeOptions) {
    this.root = root
    this.onOpenMdFile = onOpenMdFile
    this.onOpenBinaryFile = onOpenBinaryFile
    this.root.addEventListener('click', this.handleClick)
    this.init()
  }

  private async init(): Promise<void> {
    const handle = await loadRootHandle()
    if (!handle) {
      this.renderPicker()
      return
    }
    const perm = await handle.requestPermission({ mode: 'read' })
    if (perm !== 'granted') {
      this.renderPicker()
      return
    }
    this.path = [handle]
    this.entries = await readDirectory(handle)
    this.render()
  }

  /** Open the directory picker. Requires a user gesture (tab click). */
  async pick(): Promise<void> {
    try {
      const handle = await window.showDirectoryPicker()
      this.path = [handle]
      this.entries = await readDirectory(handle)
      await storeRootHandle(handle)
      this.render()
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Directory pick failed:', err)
        this.root.innerHTML = `<div class="${className.DIRTREE}"><p class="dirtree-hint">目录选择失败。请选择一个具体的子目录（不要选择文件系统根目录 /），并确保已授权该目录的读取权限。</p></div>`
      }
    }
  }

  private async goUp(): Promise<void> {
    if (this.path.length <= 1) return
    this.path.pop()
    const current = this.path[this.path.length - 1]
    this.entries = await readDirectory(current)
    this.render()
  }

  private async openDirectory(entry: DirEntry): Promise<void> {
    if (entry.expanded) {
      entry.expanded = false
      this.render()
      return
    }
    const dirHandle = entry.handle as FileSystemDirectoryHandle
    this.path.push(dirHandle)
    this.entries = await readDirectory(dirHandle)
    entry.expanded = true
    this.render()
  }

  private async openFile(entry: DirEntry): Promise<void> {
    const handle = entry.handle as FileSystemFileHandle
    try {
      if (isMarkdown(entry.name)) {
        const file = await handle.getFile()
        const content = await file.text()
        const rendered = this.onOpenMdFile(content, entry.name)
        await this.rewriteRelativeUrls(rendered, this.path)
      } else {
        this.onOpenBinaryFile(handle, entry.name)
      }
    } catch (err) {
      console.error(`Failed to open ${entry.name}:`, err)
    }
  }

  /** Open a file reached via a relative link in rendered markdown. */
  private async openLinkedFile(
    handle: FileSystemFileHandle,
    name: string,
    targetPath: FileSystemDirectoryHandle[],
  ): Promise<void> {
    console.log(
      '[dirtree] opening linked file:',
      name,
      'path depth:',
      targetPath.length,
    )
    this.path = targetPath
    this.entries = await readDirectory(targetPath[targetPath.length - 1])
    this.render()
    try {
      const file = await handle.getFile()
      const content = await file.text()
      const rendered = this.onOpenMdFile(content, name)
      await this.rewriteRelativeUrls(rendered, this.path)
    } catch (err) {
      console.error(`Failed to open linked file ${name}:`, err)
    }
  }

  /**
   * Rewrite relative image/link URLs in a rendered element to point at the
   * real files, resolved via the File System handles rooted at `path`.
   * Link handlers are attached before image loading so they always work
   * even if an image file is unreadable.
   */
  private async rewriteRelativeUrls(
    container: HTMLElement,
    path: FileSystemDirectoryHandle[],
  ): Promise<void> {
    // --- collect & attach link handlers first (no image loading needed) ---
    for (const a of Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a[href]'),
    )) {
      const href = a.getAttribute('href')
      if (!href || isAbsoluteUrl(href)) continue
      const resolved = await resolveRelative(href, path)
      if (resolved?.handle.kind !== 'file') {
        console.warn('[dirtree] link unresolved:', href)
        continue
      }
      const targetHandle = resolved.handle as FileSystemFileHandle
      const targetPath = resolved.path
      const label = a.textContent || href
      a.addEventListener('click', e => {
        e.preventDefault()
        e.stopPropagation()
        void this.openLinkedFile(targetHandle, label, targetPath)
      })
    }

    // --- collect & replace images with blob URLs ---
    const imageJobs: Array<{
      img: HTMLImageElement
      handle: FileSystemFileHandle
    }> = []
    for (const img of Array.from(
      container.querySelectorAll<HTMLImageElement>('img[src]'),
    )) {
      const src = img.getAttribute('data-rel-src')
      if (!src) continue
      const resolved = await resolveRelative(src, path)
      if (resolved?.handle.kind === 'file') {
        imageJobs.push({ img, handle: resolved.handle as FileSystemFileHandle })
      }
    }
    const imageResults = await Promise.allSettled(
      imageJobs.map(j => j.handle.getFile()),
    )
    for (let i = 0; i < imageJobs.length; i++) {
      const result = imageResults[i]
      if (result.status === 'rejected') {
        console.error('Failed to load image:', result.reason)
        continue
      }
      const blobUrl = URL.createObjectURL(result.value)
      imageJobs[i].img.src = blobUrl
    }
  }

  private handleClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement
    const dirEl = target.closest<HTMLElement>(`.${className.DIRTREE_DIR}`)
    if (dirEl) {
      const entry = entryMap.get(dirEl)
      if (entry) void this.openDirectory(entry)
      return
    }
    const fileEl = target.closest<HTMLElement>(`.${className.DIRTREE_FILE}`)
    if (fileEl) {
      const entry = entryMap.get(fileEl)
      if (entry) void this.openFile(entry)
      return
    }
    if (target.closest(`.${className.DIRTREE_GO_UP}`)) {
      void this.goUp()
      return
    }
    if (target.closest(`.${className.DIRTREE_PICK_BTN}`)) {
      void this.pick()
    }
  }

  private renderPicker(): void {
    this.root.innerHTML = ''
    const wrap = new Ele<HTMLElement>('div', {
      className: className.DIRTREE,
    })
    const hint = new Ele<HTMLElement>('p', {
      className: 'dirtree-hint',
    })
    hint.textContent =
      '点击下方按钮，选择一个包含 Markdown 文件的目录作为浏览根目录（请勿选择文件系统根目录/）'
    wrap.append(hint)
    const btn = new Ele<HTMLElement>('button', {
      className: className.DIRTREE_PICK_BTN,
    })
    btn.textContent = '选择目录'
    wrap.append(btn)
    this.root.appendChild(wrap.ele)
  }

  private render(): void {
    this.root.innerHTML = ''
    const wrap = new Ele<HTMLElement>('div', { className: className.DIRTREE })

    // current path header
    const current = this.path[this.path.length - 1]
    const pathHeader = new Ele<HTMLElement>('div', {
      className: 'dirtree-path',
    })
    pathHeader.textContent = `📁 /${this.path.map(h => h.name).join('/')}`
    pathHeader.ele.title = '当前浏览目录（已授权，可访问其下所有子目录）'
    wrap.append(pathHeader)

    // go up button
    const goUp = new Ele<HTMLElement>('button', {
      className: `${className.DIRTREE_GO_UP} ${
        this.path.length <= 1 ? 'disabled' : ''
      }`,
    })
    goUp.textContent = '↑ 上级目录'
    wrap.append(goUp)

    // entry list
    const list = new Ele<HTMLElement>('ul', {})
    this.entries.forEach(entry => {
      list.append(this.renderEntry(entry))
    })
    wrap.append(list)
    this.root.appendChild(wrap.ele)
  }

  private renderEntry(entry: DirEntry): HTMLElement {
    const li = new Ele<HTMLElement>('li', {
      className: `${className.DIRTREE_ITEM} ${
        entry.type === 'directory'
          ? className.DIRTREE_DIR
          : className.DIRTREE_FILE
      }`,
    })
    entryMap.set(li.ele, entry)

    // toggle arrow
    const toggle = new Ele<HTMLElement>('span', {
      className: `${className.DIRTREE_TOGGLE} ${entry.expanded ? 'open' : ''}`,
    })
    toggle.textContent = entry.expanded ? '▾' : '▸'

    // label
    const label = new Ele<HTMLElement>('span', {
      className: 'dirtree-label',
    })
    label.textContent =
      entry.type === 'directory' ? `📁 ${entry.name}` : entry.name

    li.append([toggle, label])

    if (entry.type === 'directory' && entry.expanded) {
      const children = new Ele<HTMLElement>('ul', {
        className: className.DIRTREE_CHILDREN,
      })
      entry.children.forEach(child => {
        children.append(this.renderEntry(child))
      })
      li.append(children)
    }
    return li.ele
  }
}
