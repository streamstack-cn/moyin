import type { PDFDocumentProxy } from 'pdfjs-dist'

const MIN = 0.6
const MAX = 2.5

export function clampPdfScale(n: number): number {
  return Math.min(MAX, Math.max(MIN, Math.round(n * 100) / 100))
}

function storageKey(bookId: string) {
  return `moyin_pdf_scale:${bookId}`
}

/** 读取该书用户手动调过的缩放；没有则 null（应走自适应） */
export function loadBookPdfScale(bookId: string): number | null {
  try {
    const raw = localStorage.getItem(storageKey(bookId))
    if (raw == null || raw === '') return null
    const v = Number(raw)
    if (Number.isFinite(v) && v >= MIN && v <= MAX) return clampPdfScale(v)
  } catch {
    /* private mode */
  }
  return null
}

/** 记住该书缩放（用户点 +/- 或双指松手后） */
export function saveBookPdfScale(bookId: string, scale: number) {
  try {
    localStorage.setItem(storageKey(bookId), String(clampPdfScale(scale)))
  } catch {
    /* private mode */
  }
}

/** 清除该书缩放记忆（恢复自适应时调用） */
export function clearBookPdfScale(bookId: string) {
  try {
    localStorage.removeItem(storageKey(bookId))
  } catch {
    /* private mode */
  }
}

/**
 * 按当前视口把 PDF 页完整放入屏幕（contain）。
 * 优先用当前页；失败时回退第 1 页。
 */
export async function computePdfFitScale(
  pdf: PDFDocumentProxy,
  containerWidth: number,
  containerHeight: number,
  pageNumber = 1,
): Promise<number> {
  const pageNo = Math.min(pdf.numPages, Math.max(1, pageNumber || 1))
  const page = await pdf.getPage(pageNo)
  const vp = page.getViewport({ scale: 1 })
  const padX = 20
  const padY = 28
  const availW = Math.max(120, containerWidth - padX)
  const availH = Math.max(160, containerHeight - padY)
  const fit = Math.min(availW / vp.width, availH / vp.height)
  return clampPdfScale(fit)
}
