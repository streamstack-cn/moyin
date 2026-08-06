import { describe, expect, it } from 'vitest'
import {
  ACCIDENTAL_SELECT_CHARS,
  isAccidentalTapSelection,
  isIntentionalTextSelection,
  pointerTravel,
  TAP_MOVE_PX,
} from './readerGestures'
import {
  resolveHorizontalSwipe,
  resolveHorizontalSwipeByTravel,
  SWIPE_THRESHOLD_PX,
} from './readerPageTurnGestures'
import { epubPersistableLocator, pdfPersistableLocator } from './readerSelection'

describe('readerGestures accidental vs intentional', () => {
  const long = '字'.repeat(ACCIDENTAL_SELECT_CHARS)

  it('clears instant tap with huge selection', () => {
    expect(isAccidentalTapSelection(long, 0, 50)).toBe(true)
    expect(isIntentionalTextSelection(long, 0, 50)).toBe(false)
  })

  it('keeps selection when user dragged', () => {
    expect(isAccidentalTapSelection(long, TAP_MOVE_PX, 50)).toBe(false)
    expect(isIntentionalTextSelection(long, TAP_MOVE_PX, 50)).toBe(true)
  })

  it('keeps selection on long press', () => {
    expect(isAccidentalTapSelection(long, 0, 400)).toBe(false)
  })

  it('pointerTravel is hypotenuse', () => {
    expect(pointerTravel({ x: 0, y: 0 }, 3, 4)).toBe(5)
    expect(pointerTravel(null, 3, 4)).toBe(0)
  })
})

describe('readerPageTurnGestures', () => {
  it('requires horizontal dominance', () => {
    const start = { clientX: 100, clientY: 100 }
    expect(resolveHorizontalSwipe(start, { clientX: 100 - SWIPE_THRESHOLD_PX - 1, clientY: 100 }, {}).direction).toBe(
      'next',
    )
    expect(resolveHorizontalSwipe(start, { clientX: 100 + SWIPE_THRESHOLD_PX + 1, clientY: 100 }, {}).direction).toBe(
      'prev',
    )
    expect(resolveHorizontalSwipe(start, { clientX: 100 - 20, clientY: 100 - 80 }, {}).handled).toBe(false)
  })

  it('uses peak travel when end point rebounds', () => {
    expect(resolveHorizontalSwipeByTravel(-80, 80, 10, {}).direction).toBe('next')
    expect(resolveHorizontalSwipeByTravel(80, 80, 10, {}).direction).toBe('prev')
    expect(resolveHorizontalSwipeByTravel(-20, 20, 5, {}).handled).toBe(false)
  })
})

describe('readerSelection locators', () => {
  it('epub drops mobile- ephemeral', () => {
    expect(epubPersistableLocator('mobile-x')).toBe('')
  })

  it('pdf falls back to page', () => {
    expect(pdfPersistableLocator('', 12)).toBe('pdf:#page=12')
  })
})
