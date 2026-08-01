/** 对齐 Google Play Books 的四色高亮 */
export const HIGHLIGHT_COLORS = ['#fbbc04', '#34a853', '#4285f4', '#ea4335']

export const BASKET_PROJECT_KEY = 'moyin_basket_project_id'

export interface SelectionAnchor {
  /** 相对阅读视口：首块中心 X、顶边 Y（兼容） */
  x: number
  y: number
  height: number
  /** 末块右下角（推荐锚点，避免压住选区中间） */
  endX?: number
  endY?: number
  /** 松手时指针位置（优先于 end） */
  pointerX?: number
  pointerY?: number
}
