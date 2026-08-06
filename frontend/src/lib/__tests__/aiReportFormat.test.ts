import { describe, expect, it } from 'vitest'
import {
  labelReportField,
  parseLabeledInsightText,
  parseReportDisplayBlocks,
  renderReportValue,
  sanitizeReportText,
  sectionKindForKey,
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

  it('parses insight objects into display blocks', () => {
    const blocks = parseReportDisplayBlocks(
      [
        { insight: '要', argumentation: '论', reflection: '思' },
        { 要点: '二', 论证: '证' },
      ],
      'insights',
    )
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ type: 'insight', index: 1 })
    if (blocks[0].type === 'insight') {
      expect(blocks[0].fields.map((f) => f.label)).toEqual(['要点', '论证', '我的思考'])
    }
  })

  it('parses flattened insight text', () => {
    const blocks = parseLabeledInsightText('（1）\n要点：甲\n论证：乙\n\n（2）\n要点：丙')
    expect(blocks).toHaveLength(2)
    expect(blocks[0].type).toBe('insight')
  })

  it('maps section keys to layout kinds', () => {
    expect(sectionKindForKey('content_summary')).toBe('lede')
    expect(sectionKindForKey('core_insights')).toBe('insights')
    expect(sectionKindForKey('personal_reflections')).toBe('quote')
  })
})
