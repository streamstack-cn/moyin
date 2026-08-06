/**
 * 请求关联 ID：前端生成并放入 X-Request-Id，后端回写同名响应头，
 * 错误文案/日志可对齐排查。
 */
const REQUEST_ID_HEADER = 'X-Request-Id'

export function createRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* ignore */
  }
  return `moyin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function getRequestIdHeaderName() {
  return REQUEST_ID_HEADER
}

/** 把业务错误与 requestId 拼成可读信息（不重复追加） */
export function formatApiErrorMessage(detail: string, requestId: string | null | undefined): string {
  const base = (detail || '请求失败').trim()
  if (!requestId) return base
  if (base.includes(requestId)) return base
  return `${base}（请求 ID: ${requestId}）`
}
