import { describe, expect, it } from 'vitest'
import {
  labelReportField,
  renderReportValue,
  sanitizeReportText,
} from '../aiReportFormat'

describe('aiReportFormat', () => {
  it('maps english insight keys to chinese labels', () => {
    expect(labelReportField('insight')).toBe('要点')
    expect(labelReportField('argumentation')).toBe('论证')
    expect(labelReportField('my_thoughts')).toBe('我的思考')
    expect(labelReportField('要点')).toBe('要点')
  })

  it('sanitizes english labels inside plain text', () => {
    const raw = '开头。\nargumentation：证据在此\nmy_thoughts：个人想法'
    const out = sanitizeReportText(raw)
    expect(out).toContain('论证：证据在此')
    expect(out).toContain('我的思考：个人想法')
    expect(out).not.toMatch(/argumentation/i)
  })

  it('renders chinese-key insight objects in preferred order', () => {
    const out = renderReportValue([
      {
        我的思考: '思',
        论证: '论',
        要点: '要',
      },
    ])
    expect(out.indexOf('要点：')).toBeLessThan(out.indexOf('论证：'))
    expect(out.indexOf('论证：')).toBeLessThan(out.indexOf('我的思考：'))
    expect(out.startsWith('（1）')).toBe(true)
  })

  it('renders english-key insight objects as chinese', () => {
    const out = renderReportValue({
      insight: 'A',
      argumentation: 'B',
      reflection: 'C',
    })
    expect(out).toContain('要点：A')
    expect(out).toContain('论证：B')
    expect(out).toContain('我的思考：C')
    expect(out).not.toMatch(/\binsight\b/i)
  })
})
