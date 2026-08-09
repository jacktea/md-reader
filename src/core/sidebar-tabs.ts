import Ele from '@/core/ele'
import className from '@/config/class-name'

const TAB_STORAGE_KEY = 'sidebarActiveTab'

interface TabEntry {
  btn: Ele<HTMLElement>
  panel: HTMLElement
}

export interface SidebarTabsOptions {
  /** outline content element (ul that renderSide() populates) */
  outlineList: HTMLElement
  /** current file URL for persisting tab state */
  currentUrl: string
  /** callback when the active tab changes */
  onTabChange?: (tab: string) => void
}

export default class SidebarTabs {
  private root: Ele<HTMLElement>
  private tabBar: Ele<HTMLElement>
  private contentArea: Ele<HTMLElement>
  private currentUrl: string
  private activeTab: string = 'outline'
  private onTabChange?: (tab: string) => void
  private tabs: Record<string, TabEntry> = {}

  constructor(options: SidebarTabsOptions) {
    this.currentUrl = options.currentUrl
    this.onTabChange = options.onTabChange

    this.root = new Ele<HTMLElement>('div', {
      className: className.SIDE_TABS,
    })
    this.tabBar = new Ele<HTMLElement>('div', {
      className: className.TAB_BAR,
    })
    this.contentArea = new Ele<HTMLElement>('div', {
      className: className.TAB_CONTENT,
    })
    this.root.append([this.tabBar, this.contentArea])

    // register the outline tab
    this.addTab('outline', '大纲', options.outlineList)

    // apply default state synchronously
    this.applyActiveTab()

    // restore persisted tab
    void this.restoreTab()
  }

  /** Register a new tab dynamically. */
  addTab(id: string, label: string, panel: HTMLElement): void {
    if (this.tabs[id]) return // already exists

    const btn = new Ele<HTMLElement>('span', {
      className: className.TAB_ITEM,
    })
    btn.textContent = label
    btn.on('click', () => this.activateTab(id))
    this.tabBar.append(btn)
    this.contentArea.append(panel)
    this.tabs[id] = { btn, panel }
    this.applyActiveTab()
  }

  private async restoreTab(): Promise<void> {
    const key = `${TAB_STORAGE_KEY}:${this.currentUrl}`
    const all = await new Promise<Record<string, string>>(resolve =>
      chrome.storage.local.get(null, result => resolve(result)),
    )
    const saved = all[key] as string | undefined
    if (saved && saved in this.tabs) {
      this.activeTab = saved
      this.applyActiveTab()
    }
  }

  private async persistTab(): Promise<void> {
    const key = `${TAB_STORAGE_KEY}:${this.currentUrl}`
    await new Promise<void>(resolve =>
      chrome.storage.local.set({ [key]: this.activeTab }, () => resolve()),
    )
  }

  private applyActiveTab(): void {
    for (const id of Object.keys(this.tabs)) {
      const { btn, panel } = this.tabs[id]
      if (id === this.activeTab) {
        btn.classList.add(className.TAB_ACTIVE)
        panel.style.display = ''
      } else {
        btn.classList.remove(className.TAB_ACTIVE)
        panel.style.display = 'none'
      }
    }
  }

  activateTab(id: string): void {
    if (!(id in this.tabs) || this.activeTab === id) return
    this.activeTab = id
    this.applyActiveTab()
    void this.persistTab()
    this.onTabChange?.(id)
  }

  get active(): string {
    return this.activeTab
  }

  get element(): HTMLElement {
    return this.root.ele
  }
}
