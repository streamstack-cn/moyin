import { useCallback, useLayoutEffect, useState } from 'react'

/**
 * 计算容器「一行」能放下多少个定宽卡片，用于横向单排、随屏宽/移动端自适应数量
 * 的推荐区（如书库「高分推荐」、首页「每日一句」摘录区）。
 *
 * 注意：这里用「回调 ref」而不是外部传入的 RefObject——推荐区容器本身是条件渲染的
 * （数据没加载完之前根本不在 DOM 里），如果用 RefObject + useLayoutEffect(deps 只含
 * 常量) 的写法，effect 只会在挂载时跑一次；当时 ref.current 还是 null，之后容器真正
 * 出现在 DOM 里时 effect 不会重新执行（依赖数组没变化），ResizeObserver 永远装不上，
 * count 就会一直卡在初始的 min 值——这正是「高分推荐只显示 3 本」的根因。
 * 回调 ref 能在节点真正挂载的那一刻把节点存进 state，从而让 effect 重新执行。
 */
export function useRowCapacity(opts: {
  minItemWidth: number
  gap?: number
  min?: number
  max?: number
}): [number, (node: HTMLDivElement | null) => void] {
  const { minItemWidth, gap = 20, min = 2, max = 24 } = opts
  const [count, setCount] = useState(min)
  const [node, setNode] = useState<HTMLDivElement | null>(null)

  const refCallback = useCallback((el: HTMLDivElement | null) => {
    setNode(el)
  }, [])

  useLayoutEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return

    const update = () => {
      const w = node.clientWidth || minItemWidth
      const cols = Math.max(1, Math.floor((w + gap) / (minItemWidth + gap)))
      setCount(Math.max(min, Math.min(max, cols)))
    }

    update()
    const ro = new ResizeObserver(update)
    ro.observe(node)
    return () => ro.disconnect()
  }, [node, minItemWidth, gap, min, max])

  return [count, refCallback]
}
