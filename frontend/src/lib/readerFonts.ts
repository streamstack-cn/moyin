import type { FontFamilyId } from '../contexts/UISettingsContext'

/** 阅读界面字体选项（与界面设置页共用） */
export const READER_FONT_OPTIONS: {
  id: FontFamilyId
  label: string
  shortLabel: string
  fontFamily: string
}[] = [
  {
    id: 'default',
    label: '思源宋体',
    shortLabel: '宋体',
    fontFamily: '"Noto Serif SC", "PMingLiU", serif',
  },
  {
    id: 'wqy',
    label: '文泉驿正黑',
    shortLabel: '黑体',
    fontFamily: '"WenQuanYi Zen Hei", "WenQuanYi Micro Hei", sans-serif',
  },
  {
    id: 'smiley',
    label: '得意黑',
    shortLabel: '得意',
    fontFamily: '"SmileySans", "PingFang SC", sans-serif',
  },
  {
    id: 'dingtalk',
    label: '钉钉进步',
    shortLabel: '进步',
    fontFamily: '"DingTalkJinBuTi", "PingFang SC", sans-serif',
  },
]

/** 阅读正文字体 CSS（供 EPUB themes / 摘录等共用） */
export function readerFontFamilyCss(id: FontFamilyId | string | undefined): string {
  switch (id) {
    case 'smiley':
      return '"SmileySans", "PingFang SC", "Microsoft YaHei", sans-serif'
    case 'dingtalk':
      return '"DingTalkJinBuTi", "PingFang SC", "Microsoft YaHei", sans-serif'
    case 'wqy':
      return '"WenQuanYi Zen Hei", "WenQuanYi Micro Hei", "文泉驿正黑", "PingFang SC", sans-serif'
    default:
      return '"Noto Serif SC", "PMingLiU", serif'
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function fetchFontFaceRule(url: string, family: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`字体加载失败: ${url}`)
  const buf = await res.arrayBuffer()
  const b64 = arrayBufferToBase64(buf)
  return `@font-face{font-family:'${family}';src:url(data:font/truetype;base64,${b64}) format('truetype');font-weight:normal;font-style:normal;font-display:swap;}`
}

let epubFontCssPromise: Promise<string> | null = null

/**
 * EPUB iframe 多为 blob/opaque origin，跨域引用 /fonts/*.ttf 会被浏览器拦截。
 * 因此把字体打成 data-URI 注入（模块级缓存，只拉一次）。
 */
export function loadEpubReaderFontFaceCss(): Promise<string> {
  if (!epubFontCssPromise) {
    epubFontCssPromise = Promise.all([
      fetchFontFaceRule('/fonts/SmileySans-Oblique.ttf', 'SmileySans'),
      fetchFontFaceRule('/fonts/DingTalk-JinBuTi.ttf', 'DingTalkJinBuTi'),
    ])
      .then((parts) => parts.join('\n'))
      .catch((err) => {
        epubFontCssPromise = null
        console.warn('[readerFonts] 自定义字体预加载失败', err)
        // 回退到 URL 引用（需 nginx CORS）；总比没有强
        return `
@font-face{font-family:'SmileySans';src:url('/fonts/SmileySans-Oblique.ttf') format('truetype');font-display:swap;}
@font-face{font-family:'DingTalkJinBuTi';src:url('/fonts/DingTalk-JinBuTi.ttf') format('truetype');font-display:swap;}
`.trim()
      })
  }
  return epubFontCssPromise
}

/** 向 EPUB iframe document 注入 @font-face（异步、幂等、可更新） */
export function injectEpubReaderFonts(doc: Document): void {
  if (!doc?.head) return
  let style = doc.getElementById('moyin-reader-fonts') as HTMLStyleElement | null
  if (!style) {
    style = doc.createElement('style')
    style.id = 'moyin-reader-fonts'
    doc.head.appendChild(style)
  }
  // 已有 data-URI 内容则跳过
  if (style.dataset.ready === '1' && style.textContent && style.textContent.length > 1000) return

  void loadEpubReaderFontFaceCss().then((css) => {
    if (!doc.head || !style) return
    style.textContent = css
    style.dataset.ready = '1'
  })
}

/** 预热字体（进入阅读器时尽早拉取，减少首次切字体闪回退） */
export function prefetchEpubReaderFonts(): void {
  void loadEpubReaderFontFaceCss()
}
