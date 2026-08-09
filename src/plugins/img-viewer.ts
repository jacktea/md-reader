import debounce from 'lodash.debounce'
import className from '@/config/class-name'
import Ele from '@/core/ele'

let ele: HTMLImageElement = null
let modal: Ele<HTMLElement> = null
let clonedEle: Ele<HTMLImageElement> = null
let setPosition = null
let images: HTMLImageElement[] = []
let imageIndex = -1
let positionContainer: HTMLElement = null
const debounceSetLastPosition = debounce(() => {
  if (ele) {
    setPosition(calcLastPosition(ele.naturalWidth, ele.naturalHeight))
  }
}, 100)

function isPreviewableImage(element: HTMLImageElement): boolean {
  return !element.closest('a')
}

function showImage(element: HTMLImageElement, fromElement?: HTMLImageElement) {
  if (fromElement) {
    fromElement.style.visibility = ''
  }

  ele = element
  clonedEle.src = ele.currentSrc || ele.src
  clonedEle.ele.alt = ele.alt
  ele.style.visibility = 'hidden'

  const updatePosition = () => {
    if (ele !== element) return
    setPosition(
      calcLastPosition(
        clonedEle.ele.naturalWidth || ele.naturalWidth,
        clonedEle.ele.naturalHeight || ele.naturalHeight,
      ),
    )
  }

  if (clonedEle.ele.complete) {
    updatePosition()
  } else {
    clonedEle.once('load', updatePosition)
  }
}

function switchImage(offset: number) {
  if (images.length < 2) return

  const previous = ele
  imageIndex = (imageIndex + offset + images.length) % images.length
  showImage(images[imageIndex], previous)
}

function closeModal(e?: Event) {
  if (modal?.classList.contains('opened')) {
    document.removeEventListener('keydown', onKeydown)
    window.removeEventListener('resize', debounceSetLastPosition)
    debounceSetLastPosition.cancel()

    modal.once('transitionend', function hidden() {
      if (ele) ele.style.visibility = ''
      modal.hide()
      clonedEle.hide()
      clonedEle.src = ''
      ele = null
      images = []
      imageIndex = -1
      positionContainer = null
    })

    setPosition(calcFirstPosition(ele, positionContainer))
    modal.classList.remove('opened')
  }

  if (e) {
    e.stopPropagation()
    e.preventDefault()
  }
}

function onKeydown(e: KeyboardEvent) {
  if (!modal?.classList.contains('opened')) return

  if (e.code === 'ArrowLeft') {
    switchImage(-1)
  } else if (e.code === 'ArrowRight') {
    switchImage(1)
  } else if (e.code === 'Escape') {
    closeModal(e)
    return
  } else {
    return
  }

  e.stopPropagation()
  e.preventDefault()
}

export function imgViewer(
  element: HTMLImageElement,
  container = document.documentElement,
) {
  // prevent the element closure
  ele = element
  positionContainer = container

  const gallery =
    element.closest<HTMLElement>(`.${className.MD_CONTENT}`) || container
  images = Array.from(gallery.querySelectorAll<HTMLImageElement>('img')).filter(
    isPreviewableImage,
  )
  imageIndex = images.indexOf(element)
  if (imageIndex < 0) {
    images = [element]
    imageIndex = 0
  }

  // init modal
  if (!modal) {
    modal = new Ele<HTMLElement>('div', {
      className: className.MODAL,
    })
    modal.setStyle({ display: 'none' })
    modal.on('click', closeModal)
    document.body.append(modal.ele)
  }

  // init clonedEle
  if (!clonedEle) {
    clonedEle = new Ele<HTMLImageElement>('img', {
      className: className.ZOOM_IMAGE,
    })
    clonedEle.setStyle({ display: 'none' })
    setPosition = setPositionWithEle(clonedEle.ele)
    modal.append(clonedEle)
  }
  // init first position
  setPosition(calcFirstPosition(ele, container))
  clonedEle.src = ele.currentSrc || ele.src
  clonedEle.ele.alt = ele.alt
  clonedEle.show()

  // open the modal
  modal.show()

  // transition to last position after the modal opened
  requestAnimationFrame(() => {
    setPosition(calcLastPosition(ele.naturalWidth, ele.naturalHeight))
    ele.style.visibility = 'hidden'
    modal.classList.add('opened')
  })

  // update last position
  window.addEventListener('resize', debounceSetLastPosition)
  document.addEventListener('keydown', onKeydown)
}

export default function imgViewerPlugin({ event }) {
  // image viewer event
  event.on('click', (target: HTMLElement) => {
    if (target.tagName.toLowerCase() === 'img') {
      let parent = target.parentElement
      while (parent) {
        if (parent.tagName === 'A') {
          return
        }
        parent = parent.parentElement
      }
      imgViewer(target as HTMLImageElement)
    }
  })
}

type Posi = {
  width: number
  height: number
  rate?: number
  x: number
  y: number
}

function setElePosition(element: HTMLImageElement, position: Posi): void {
  Object.assign(element.style, {
    width: position.width + 'px',
    height: position.height + 'px',
    transform: `translate(${position.x}px, ${position.y}px)`,
  })
}

function setPositionWithEle(
  element: HTMLImageElement,
): (position: Posi) => void {
  return (position: Posi) => setElePosition(element, position)
}

function calcFirstPosition(
  element: HTMLImageElement,
  container: HTMLElement,
): Posi {
  return {
    width: element.offsetWidth,
    height: element.offsetHeight,
    x: element.offsetLeft - container.scrollLeft,
    y: element.offsetTop - container.scrollTop,
  }
}

function calcLastPosition(width: number, height: number): Posi {
  const rate = width / height
  const screenWidth = window.innerWidth
  const screenHeight = window.innerHeight

  let lastWidth = width
  let lastHeight = height
  if (lastWidth > screenWidth || lastHeight > screenHeight) {
    lastWidth = screenWidth
    lastHeight = lastWidth / rate
    if (lastHeight > screenHeight) {
      lastHeight = screenHeight
      lastWidth = lastHeight * rate
    }
  }
  const lastPositionX = (screenWidth - lastWidth) / 2
  const lastPositionY = (screenHeight - lastHeight) / 2

  return {
    width: lastWidth,
    height: lastHeight,
    x: lastPositionX,
    y: lastPositionY,
    rate,
  }
}
