import mermaid from 'mermaid'

const ZOOM_WRAPPER_CLASS = 'md-reader__mermaid-zoom'
const ZOOM_MIN = 0.2
const ZOOM_MAX = 5
const ZOOM_STEP = 0.2

/**
 * Render every `.mermaid` element inside `container`, then enable zoom/pan
 * interactions. Resolves after the diagrams are shown (or fail).
 * No-op when there are no mermaid blocks.
 */
export async function renderDiagrams(container: HTMLElement): Promise<void> {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>('.mermaid'))
  if (nodes.length === 0) return

  // hide source code until rendered, to avoid a flash of raw mermaid text
  nodes.forEach(n => {
    n.style.display = 'none'
  })

  try {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const code = node.textContent || ''
      const id = `md-reader-mermaid-${i}-${Date.now()}`
      const svg = await mermaid.mermaidAPI.render(id, code)
      node.innerHTML = svg
    }
  } catch (err) {
    console.error('[mermaid] render failed:', err)
  } finally {
    nodes.forEach(n => {
      n.style.display = ''
      enableZoomPan(n)
    })
  }
}

// ── toolbar SVG icons ──────────────────────────────────────────────

const ZOOM_IN_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`
const ZOOM_OUT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`
const FIT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`

// ── zoom/pan logic ─────────────────────────────────────────────────

interface ZoomState {
  scale: number
  tx: number
  ty: number
}

function createToolbar(
  wrapper: HTMLElement,
  zoom: ZoomState,
  apply: () => void,
): void {
  const bar = document.createElement('div')
  bar.className = 'mermaid-toolbar'

  // zoom in — centered on wrapper center
  const zoomIn = () => {
    const cx = wrapper.clientWidth / 2
    const cy = wrapper.clientHeight / 2
    const oldScale = zoom.scale
    zoom.scale = Math.min(ZOOM_MAX, zoom.scale + ZOOM_STEP)
    zoom.tx = cx - (cx - zoom.tx) * (zoom.scale / oldScale)
    zoom.ty = cy - (cy - zoom.ty) * (zoom.scale / oldScale)
    apply()
  }

  // zoom out — centered on wrapper center
  const zoomOut = () => {
    const cx = wrapper.clientWidth / 2
    const cy = wrapper.clientHeight / 2
    const oldScale = zoom.scale
    zoom.scale = Math.max(ZOOM_MIN, zoom.scale - ZOOM_STEP)
    zoom.tx = cx - (cx - zoom.tx) * (zoom.scale / oldScale)
    zoom.ty = cy - (cy - zoom.ty) * (zoom.scale / oldScale)
    apply()
  }

  const btn = (icon: string, title: string, onClick: () => void) => {
    const b = document.createElement('button')
    b.className = 'mermaid-toolbar-btn'
    b.title = title
    b.innerHTML = icon
    b.addEventListener('click', e => {
      e.stopPropagation()
      onClick()
    })
    return b
  }

  bar.append(
    btn(ZOOM_IN_ICON, '放大', zoomIn),
    btn(ZOOM_OUT_ICON, '缩小', zoomOut),
    btn(FIT_ICON, '自适应', () => {
      zoom.scale = 1
      zoom.tx = 0
      zoom.ty = 0
      apply()
    }),
  )

  wrapper.appendChild(bar)
}

function enableZoomPan(el: HTMLElement): void {
  if (el.closest(`.${ZOOM_WRAPPER_CLASS}`)) return

  const wrapper = document.createElement('div')
  wrapper.className = ZOOM_WRAPPER_CLASS
  el.parentNode?.insertBefore(wrapper, el)
  wrapper.appendChild(el)

  const zoom: ZoomState = { scale: 1, tx: 0, ty: 0 }
  let dragging = false
  let startX = 0
  let startY = 0
  let startTx = 0
  let startTy = 0

  // apply transform — no clamping, user can always tap "fit" to reset
  const apply = () => {
    el.style.transformOrigin = '0 0'
    el.style.transform = `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})`
  }

  // toolbar
  createToolbar(wrapper, zoom, apply)

  // wheel zoom — centered on cursor position
  wrapper.addEventListener('wheel', e => {
    e.preventDefault()
    const rect = wrapper.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const oldScale = zoom.scale
    const factor = e.deltaY > 0 ? 1 - ZOOM_STEP : 1 + ZOOM_STEP
    zoom.scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom.scale * factor))
    zoom.tx = mx - (mx - zoom.tx) * (zoom.scale / oldScale)
    zoom.ty = my - (my - zoom.ty) * (zoom.scale / oldScale)
    apply()
  })

  // drag to pan
  wrapper.addEventListener('mousedown', e => {
    if (e.button !== 0) return
    dragging = true
    startX = e.clientX
    startY = e.clientY
    startTx = zoom.tx
    startTy = zoom.ty
    wrapper.style.cursor = 'grabbing'
  })

  const onMove = (clientX: number, clientY: number) => {
    if (!dragging) return
    zoom.tx = startTx + (clientX - startX) / zoom.scale
    zoom.ty = startTy + (clientY - startY) / zoom.scale
    apply()
  }

  window.addEventListener('mousemove', e => onMove(e.clientX, e.clientY))
  window.addEventListener('mouseup', () => {
    if (!dragging) return
    dragging = false
    wrapper.style.cursor = 'grab'
  })

  // double-click to reset
  wrapper.addEventListener('dblclick', () => {
    zoom.scale = 1
    zoom.tx = 0
    zoom.ty = 0
    apply()
  })

  wrapper.style.cursor = 'grab'
}
