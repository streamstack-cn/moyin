import { afterEach, describe, expect, it } from 'vitest'
import {
  AI_GENERATE_SESSION_KEY,
  __resetAiGenerateSessionForTests,
  getAiGenerateSession,
  hydrateAiGenerateSessionFromStorage,
  isLikelyNetworkFailure,
  phaseLabel,
  sameBookIds,
} from './aiGenerateSession'

/** 与模块 storage 回落一致：无 DOM 时写入 memory；有 DOM 时写 sessionStorage */
function writePersisted(payload: unknown) {
  const raw = JSON.stringify(payload)
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(AI_GENERATE_SESSION_KEY, raw)
      return
    }
  } catch {
    /* ignore */
  }
  // 触发 hydrate 前先通过直接调用：模块内部 memory 需经 hydrate 读 storageGet
  // 在 node 下 storageGet 读 memorySessionStore——测试无法直接写，改用动态注入：
  // 这里用 globalThis 假 sessionStorage
  const store: Record<string, string> = { [AI_GENERATE_SESSION_KEY]: raw }
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => {
        delete store[k]
      },
    },
  })
}

afterEach(() => {
  __resetAiGenerateSessionForTests()
})

describe('sameBookIds', () => {
  it('ignores order', () => {
    expect(sameBookIds(['a', 'b'], ['b', 'a'])).toBe(true)
  })

  it('rejects different lengths', () => {
    expect(sameBookIds(['a'], ['a', 'b'])).toBe(false)
  })

  it('rejects different ids', () => {
    expect(sameBookIds(['a', 'b'], ['a', 'c'])).toBe(false)
  })
})

describe('phaseLabel', () => {
  it('maps phases to human copy', () => {
    expect(phaseLabel('collecting')).toContain('收集')
    expect(phaseLabel('saving')).toContain('入库')
    expect(phaseLabel('model', 100)).toContain('模型')
    expect(phaseLabel('model', 2000)).toContain('组织')
  })
})

describe('isLikelyNetworkFailure', () => {
  it('detects fetch failures', () => {
    expect(isLikelyNetworkFailure('Failed to fetch')).toBe(true)
    expect(isLikelyNetworkFailure('连接中断')).toBe(true)
  })

  it('rejects clear business errors', () => {
    expect(isLikelyNetworkFailure('请至少选择一本书')).toBe(false)
    expect(isLikelyNetworkFailure('未配置 API Key')).toBe(false)
  })
})

describe('hydrateAiGenerateSessionFromStorage', () => {
  it('turns in-flight streaming into disconnected after refresh', () => {
    writePersisted({
      v: 1,
      status: 'streaming',
      phase: 'model',
      bookIds: ['b1'],
      streamedChars: 42,
      reportId: null,
      reportGenAt: null,
      error: null,
      lastOpts: { bookIds: ['b1'], force: true, includeFullText: false, excludeIds: [] },
    })
    hydrateAiGenerateSessionFromStorage()
    const s = getAiGenerateSession()
    expect(s.status).toBe('disconnected')
    expect(s.bookIds).toEqual(['b1'])
    expect(s.streamedChars).toBe(42)
    expect(s.error).toMatch(/中断|继续/)
    expect(s.lastOpts?.bookIds).toEqual(['b1'])
  })

  it('keeps done metadata for re-fetch', () => {
    writePersisted({
      v: 1,
      status: 'done',
      phase: null,
      bookIds: ['b2'],
      streamedChars: 100,
      reportId: 'r1',
      reportGenAt: '2026-01-01',
      error: null,
      lastOpts: { bookIds: ['b2'], force: true, includeFullText: false, excludeIds: [] },
    })
    hydrateAiGenerateSessionFromStorage()
    const s = getAiGenerateSession()
    expect(s.status).toBe('done')
    expect(s.reportId).toBe('r1')
    expect(s.report).toBeNull()
  })
})
