import { describe, expect, it } from 'vitest'
import { createRequestId, formatApiErrorMessage, getRequestIdHeaderName } from './requestId'

describe('requestId', () => {
  it('creates non-empty ids', () => {
    const a = createRequestId()
    const b = createRequestId()
    expect(a.length).toBeGreaterThan(8)
    expect(b).not.toBe(a)
  })

  it('formats message with id once', () => {
    expect(formatApiErrorMessage('失败', 'abc')).toBe('失败（请求 ID: abc）')
    expect(formatApiErrorMessage('失败（请求 ID: abc）', 'abc')).toBe('失败（请求 ID: abc）')
  })

  it('exposes header name', () => {
    expect(getRequestIdHeaderName()).toBe('X-Request-Id')
  })
})
