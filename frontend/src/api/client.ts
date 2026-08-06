import { createRequestId, formatApiErrorMessage, getRequestIdHeaderName } from '../lib/requestId'

const TOKEN_KEY = 'moyin_token'

/** 优先 localStorage（保持登录），否则 sessionStorage（关闭标签/浏览器即失效） */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string, rememberMe = true) {
  if (rememberMe) {
    localStorage.setItem(TOKEN_KEY, token)
    sessionStorage.removeItem(TOKEN_KEY)
  } else {
    sessionStorage.setItem(TOKEN_KEY, token)
    localStorage.removeItem(TOKEN_KEY)
  }
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(TOKEN_KEY)
}

/** 带 token 的请求收到 401 时回调（由 AuthProvider 注册，跳转登录） */
type UnauthorizedHandler = () => void
let unauthorizedHandler: UnauthorizedHandler | null = null

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  unauthorizedHandler = handler
}

export class ApiError extends Error {
  status: number
  requestId: string | null
  constructor(status: number, message: string, requestId: string | null = null) {
    super(message)
    this.status = status
    this.requestId = requestId
  }
}

interface RequestOptions extends RequestInit {
  raw?: boolean
}

export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getToken()
  const headers = new Headers(options.headers || {})
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (!(options.body instanceof FormData) && options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const headerName = getRequestIdHeaderName()
  if (!headers.has(headerName)) {
    headers.set(headerName, createRequestId())
  }
  const outboundId = headers.get(headerName)

  const resp = await fetch(path, { ...options, headers })
  const responseId = resp.headers.get(headerName) || outboundId

  if (!resp.ok) {
    let detail = resp.statusText
    try {
      const data = await resp.json()
      detail = data.detail || detail
    } catch {
      // ignore
    }
    // 已登录会话过期：清 token 并通知 Auth（登录接口本身的 401 不触发）
    if (resp.status === 401 && token) {
      clearToken()
      try {
        unauthorizedHandler?.()
      } catch {
        /* ignore */
      }
    }
    throw new ApiError(resp.status, formatApiErrorMessage(String(detail), responseId), responseId)
  }

  if (options.raw) return resp as unknown as T
  if (resp.status === 204) return undefined as T
  const contentType = resp.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return (await resp.json()) as T
  }
  return undefined as T
}

export const api = {
  get: <T>(path: string) => apiRequest<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) => apiRequest<T>(path, { method: 'POST', body: formData }),
}

export function downloadUrl(path: string): string {
  const token = getToken()
  const sep = path.includes('?') ? '&' : '?'
  return token ? `${path}${sep}_t=${encodeURIComponent(token)}` : path
}

/**
 * 用 fetch 而非直接 <a href> 跳转下载文件：后端返回非 2xx（如"引用篮为空"）时
 * 会被 apiRequest 解析成 ApiError 抛出，调用方 catch 后用 toast 提示即可，
 * 不会像整页跳转到下载链接那样把原始错误 JSON 呈现成一个"错误页"。
 */
export async function downloadFile(path: string, fallbackFilename = 'download'): Promise<void> {
  const resp = await apiRequest<Response>(path, { raw: true })
  const blob = await resp.blob()
  const disposition = resp.headers.get('content-disposition') || ''
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)"?/i.exec(disposition)
  const filename = match ? decodeURIComponent(match[1].replace(/"$/, '')) : fallbackFilename
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
