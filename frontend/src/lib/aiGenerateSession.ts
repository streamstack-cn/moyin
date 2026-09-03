/**
 * AI 伴读报告生成会话：挂在模块级，不随 /ai-reader 路由卸载而中断。
 * - SPA 内跳转：流式请求继续，切回仍显示生成中
 * - F5 刷新：无法续接 SSE，恢复为「已断开」并保留参数供一键继续
 * - 弱网中断：进入 disconnected，可一键重试
 */
import type { AiReport, AiReportContent } from '../api/types'
import { api, getToken } from '../api/client'
import { createRequestId, getRequestIdHeaderName } from './requestId'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || ''
export const AI_GENERATE_SESSION_KEY = 'moyin_ai_generate_session'

/** Node 单测无 sessionStorage 时回落到内存，行为与浏览器一致 */
const memorySessionStore = new Map<string, string>()

function storageGet(key: string): string | null {
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage.getItem(key)
  } catch {
    /* private mode */
  }
  return memorySessionStore.get(key) ?? null
}

function storageSet(key: string, value: string) {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(key, value)
      return
    }
  } catch {
    /* fall through */
  }
  memorySessionStore.set(key, value)
}

function storageRemove(key: string) {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(key)
      return
    }
  } catch {
    /* fall through */
  }
  memorySessionStore.delete(key)
}

export type AiGenerateStatus = 'idle' | 'streaming' | 'done' | 'error' | 'disconnected'
/** 人话阶段：收集素材 → 模型输出 → 整理入库 */
export type AiGeneratePhase = 'collecting' | 'model' | 'saving' | null

export interface AiGenerateStartOpts {
  bookIds: string[]
  force?: boolean
  includeFullText?: boolean
  excludeIds?: string[]
}

export interface AiGenerateSessionSnapshot {
  status: AiGenerateStatus
  phase: AiGeneratePhase
  bookIds: string[]
  streamedChars: number
  report: AiReportContent | null
  reportId: string | null
  reportGenAt: string | null
  reportVersion: number | undefined
  reportUpdatedAt: string | null
  error: string | null
  /** 供失败/断线一键重试 */
  lastOpts: AiGenerateStartOpts | null
}

const EMPTY: AiGenerateSessionSnapshot = {
  status: 'idle',
  phase: null,
  bookIds: [],
  streamedChars: 0,
  report: null,
  reportId: null,
  reportGenAt: null,
  reportVersion: undefined,
  reportUpdatedAt: null,
  error: null,
  lastOpts: null,
}

let snapshot: AiGenerateSessionSnapshot = { ...EMPTY }
let abortController: AbortController | null = null
let userStopped = false
/** 每次 start 递增；过期的 abort/完成回调不得覆盖新会话 */
let generationId = 0
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function persist() {
  try {
    if (snapshot.status === 'idle') {
      storageRemove(AI_GENERATE_SESSION_KEY)
      return
    }
    // 不落库完整 report（可能很大）；done 时靠 bookIds 回页再拉
    const payload = {
      v: 1 as const,
      status: snapshot.status,
      phase: snapshot.phase,
      bookIds: snapshot.bookIds,
      streamedChars: snapshot.streamedChars,
      reportId: snapshot.reportId,
      reportGenAt: snapshot.reportGenAt,
      error: snapshot.error,
      lastOpts: snapshot.lastOpts,
    }
    storageSet(AI_GENERATE_SESSION_KEY, JSON.stringify(payload))
  } catch {
    /* quota / private mode */
  }
}

function patch(partial: Partial<AiGenerateSessionSnapshot>) {
  snapshot = { ...snapshot, ...partial }
  persist()
  emit()
}

/** 供单测：阶段文案 */
export function phaseLabel(phase: AiGeneratePhase, chars = 0): string {
  if (phase === 'collecting') return '正在收集素材与高亮…'
  if (phase === 'saving') return '正在整理并入库…'
  if (phase === 'model') {
    if (chars < 400) return '模型正在输出：梳理要点…'
    if (chars < 1200) return '模型正在输出：提炼观点…'
    return '模型正在输出：组织报告结构…'
  }
  return '正在生成报告…'
}

export function sameBookIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((id, i) => id === sb[i])
}

/** 判断是否为可「继续」的网络类错误（非业务 4xx 文案） */
export function isLikelyNetworkFailure(message: string | null | undefined): boolean {
  if (!message) return true
  const m = message.toLowerCase()
  if (/failed to fetch|networkerror|load failed|network request failed|aborted|econnreset|timeout|超时|中断|断开/.test(m)) {
    return true
  }
  // 业务错误通常含中文「请」或 HTTP 状态说明，不当作弱网
  if (/请至少|未找到|未配置|401|403|402|余额|api.?key|密钥/.test(message)) return false
  return false
}

export function getAiGenerateSession(): AiGenerateSessionSnapshot {
  return snapshot
}

export function subscribeAiGenerateSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 用户点击「停止生成」；离开页面不会调用此函数 */
export function stopAiGenerateSession() {
  userStopped = true
  abortController?.abort()
}

export function clearAiGenerateSession() {
  if (snapshot.status === 'streaming') return
  snapshot = { ...EMPTY }
  persist()
  emit()
}

/**
 * 从 sessionStorage 恢复。若上次是 streaming（刷新打断 SSE），改为 disconnected。
 * 模块加载时调用一次。
 */
export function hydrateAiGenerateSessionFromStorage(): AiGenerateSessionSnapshot {
  try {
    const raw = storageGet(AI_GENERATE_SESSION_KEY)
    if (!raw) return snapshot
    const data = JSON.parse(raw) as Partial<AiGenerateSessionSnapshot> & { v?: number }
    if (!data || !Array.isArray(data.bookIds)) return snapshot

    let status = (data.status || 'idle') as AiGenerateStatus
    let error = data.error ?? null
    let phase = (data.phase ?? null) as AiGeneratePhase

    if (status === 'streaming') {
      status = 'disconnected'
      error = '页面刷新后生成已中断，可点击继续'
      phase = phase || 'model'
    }

    snapshot = {
      ...EMPTY,
      status,
      phase: status === 'idle' ? null : phase,
      bookIds: data.bookIds || [],
      streamedChars: data.streamedChars || 0,
      report: null,
      reportId: data.reportId ?? null,
      reportGenAt: data.reportGenAt ?? null,
      error,
      lastOpts: data.lastOpts ?? null,
    }
    persist()
    emit()
  } catch {
    /* ignore corrupt */
  }
  return snapshot
}

// 模块加载即恢复（浏览器环境）
hydrateAiGenerateSessionFromStorage()

/** 失败 / 断线后用上次参数重试 */
export async function retryAiGenerateSession(): Promise<void> {
  const opts = snapshot.lastOpts
  if (!opts?.bookIds?.length) return
  await startAiGenerateSession({ ...opts, force: true })
}

export async function startAiGenerateSession(opts: AiGenerateStartOpts): Promise<void> {
  const bookIds = [...opts.bookIds]
  if (!bookIds.length) return

  if (abortController) {
    userStopped = true
    abortController.abort()
    abortController = null
  }

  const myGen = ++generationId
  userStopped = false
  const controller = new AbortController()
  abortController = controller

  const lastOpts: AiGenerateStartOpts = {
    bookIds,
    force: Boolean(opts.force),
    includeFullText: Boolean(opts.includeFullText),
    excludeIds: opts.excludeIds ? [...opts.excludeIds] : [],
  }

  patch({
    status: 'streaming',
    phase: 'collecting',
    bookIds,
    streamedChars: 0,
    report: null,
    reportId: null,
    reportGenAt: null,
    error: null,
    lastOpts,
  })

  try {
    const token = getToken() || ''
    const excludeIds = (opts.excludeIds || []).join(',')
    const params = new URLSearchParams({
      book_ids: bookIds.join(','),
      force: String(Boolean(opts.force)),
      include_full_text: String(Boolean(opts.includeFullText)),
    })
    if (excludeIds) params.set('exclude_ids', excludeIds)

    const ridHeader = getRequestIdHeaderName()
    const resp = await fetch(`${BASE_URL}/api/ai-reader/generate/stream?${params.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        [ridHeader]: createRequestId(),
      },
      signal: controller.signal,
    })
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      throw new Error(errText || `生成失败（${resp.status}）`)
    }

    if (myGen === generationId) patch({ phase: 'model' })

    const reader = resp.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let reportText = ''
    let sawDone = false
    let streamError: string | null = null

    let reportId: string | null = null
    let reportGenAt: string | null = null
    let reportVersion: number | undefined = undefined
    let reportUpdatedAt: string | null = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop() || ''
      for (const evt of events) {
        const line = evt.trim()
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') {
          sawDone = true
          continue
        }
        try {
          const obj = JSON.parse(payload) as { error?: string; content?: string; cached?: boolean; id?: string; generated_at?: string; version?: number; updated_at?: string }
          if (obj.error) {
            streamError = obj.error
            continue
          }
          if (obj.cached) {
            reportId = obj.id || null
            reportGenAt = obj.generated_at || null
            reportVersion = obj.version
            reportUpdatedAt = obj.updated_at || null
          }
          if (typeof obj.content === 'string') {
            reportText += obj.content
            if (myGen === generationId) patch({ streamedChars: reportText.length, phase: 'model' })
          }
        } catch {
          /* 单帧失败跳过 */
        }
      }
    }

    if (myGen !== generationId) return
    if (streamError) throw new Error(streamError)
    if (!sawDone && !reportText) {
      throw Object.assign(new Error('连接中断，未收到报告内容'), { name: 'NetworkError' })
    }
    if (!sawDone && reportText) {
      // 有半成品但未 [DONE]：按断线处理，不把残缺 JSON 当成功
      patch({
        status: 'disconnected',
        phase: 'model',
        streamedChars: reportText.length,
        error: '连接中断，报告未完整入库。可点击继续重新生成',
      })
      return
    }

    if (myGen === generationId) patch({ phase: 'saving' })

    let clean = reportText.trim()
    if (clean.startsWith('```')) {
      clean = clean.split('\n').slice(1).join('\n')
      clean = clean.replace(/```\s*$/, '').trim()
    }

    let parsed: AiReportContent
    try {
      parsed = JSON.parse(clean) as AiReportContent
    } catch {
      parsed = { raw: reportText }
    }

    
    let finalReport = parsed
    try {
      const saved = await api.get<AiReport | null>(`/api/ai-reader/report?book_ids=${bookIds.join(',')}`)
      if (saved) {
        finalReport = saved.report
        reportId = saved.id
        reportGenAt = saved.generated_at
        reportVersion = saved.version
        reportUpdatedAt = saved.updated_at || null
      }
    } catch {
      /* 已有解析结果，拉库失败不挡展示 */
    }

    if (myGen !== generationId) return
    patch({
      status: 'done',
      phase: null,
      report: finalReport,
      reportId,
      reportGenAt,
      reportVersion,
      reportUpdatedAt,
      streamedChars: reportText.length,
      error: null,
    })
  } catch (e: unknown) {
    if (myGen !== generationId) return
    const err = e as Error
    if (err?.name === 'AbortError') {
      patch({
        status: 'idle',
        phase: null,
        streamedChars: 0,
        error: null,
        report: null,
        reportId: null,
        reportGenAt: null,
        reportVersion: undefined,
        reportUpdatedAt: null,
        // 保留 lastOpts / bookIds 方便用户再点生成；清 bookIds 以免误显示断线
        bookIds: snapshot.bookIds,
      })
      // 用户主动停止：回到 idle 并清持久化意图
      if (userStopped) {
        snapshot = {
          ...EMPTY,
          lastOpts: lastOpts,
        }
        persist()
        emit()
      }
      return
    }
    const msg = err?.message || '生成失败'
    if (isLikelyNetworkFailure(msg) || err?.name === 'NetworkError' || err?.name === 'TypeError') {
      patch({
        status: 'disconnected',
        phase: snapshot.phase || 'model',
        error: '网络中断，生成未完成。可点击继续',
        streamedChars: snapshot.streamedChars,
      })
      return
    }
    patch({
      status: 'error',
      phase: null,
      error: msg,
      streamedChars: snapshot.streamedChars,
    })
  } finally {
    if (myGen === generationId) {
      abortController = null
      userStopped = false
    }
  }
}

/** 测试用：重置内存与 storage */
export function __resetAiGenerateSessionForTests() {
  generationId += 1
  abortController = null
  userStopped = false
  snapshot = { ...EMPTY }
  storageRemove(AI_GENERATE_SESSION_KEY)
  emit()
}
