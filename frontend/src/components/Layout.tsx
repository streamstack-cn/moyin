import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useLocation, Link, type Location } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Feather, Home, LayoutGrid, LogOut, Menu, Lightbulb, Settings2, ShieldCheck, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { useUISettings } from '../contexts/UISettingsContext'
import { easeOutExpo, inkRevealVariants, softSpring } from '../lib/motion'
import { useMediaQuery } from '../lib/useMediaQuery'
import { APP_VERSION_LABEL } from '../version'
import ModeToggle from './ModeToggle'

function NavItem({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  const location = useLocation()
  const reduceMotion = useReducedMotion()
  const active = location.pathname === to
  return (
    <Link to={to} className={`nav-link ${active ? 'active' : ''}`}>
      {active && (
        reduceMotion ? (
          <span className="nav-link-ink ui-gooey-nav-ink" aria-hidden />
        ) : (
          <motion.span className="nav-link-ink ui-gooey-nav-ink" layoutId="nav-ink" transition={softSpring} aria-hidden />
        )
      )}
      <span className="nav-link-inner relative z-10" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {active ? (
          <motion.div
            animate={{ rotate: [-5, 5, -5, 5, 0], scale: [1, 1.1, 1] }}
            transition={{ duration: 0.6, ease: "easeInOut", repeat: Infinity, repeatDelay: 2 }}
            style={{ display: 'flex' }}
          >
            {icon}
          </motion.div>
        ) : (
          <div style={{ display: 'flex' }}>{icon}</div>
        )}
        {label}
      </span>
    </Link>
  )
}

export default function Layout({
  children,
  displayLocation,
}: {
  children: ReactNode
  /** 阅读页覆盖时冻结的主界面 location，避免 key 变化导致子树重挂载丢滚动 */
  displayLocation?: Location
}) {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { advancedAnim } = useUISettings()
  const navigate = useNavigate()
  const realLocation = useLocation()
  const location = displayLocation ?? realLocation
  const reduceMotion = useReducedMotion()
  const isCompact = useMediaQuery('(max-width: 900px)')
  const [mobileOpen, setMobileOpen] = useState(false)
  const mobileOpenRef = useRef(false)
  const skipRouteMotion = isCompact || reduceMotion || !advancedAnim
  const shellRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    mobileOpenRef.current = mobileOpen
  }, [mobileOpen])

  // 路由切换时收起侧栏，避免从子页返回主页时菜单仍开着
  useEffect(() => {
    setMobileOpen(false)
  }, [realLocation.pathname])

  // 移动端：仅屏幕左缘右滑打开侧栏；左滑或点遮罩关闭
  // （勿用「左半屏右滑」——会和系统/浏览器返回手势冲突，造成回主页就弹菜单）
  useEffect(() => {
    if (!isCompact) return
    const el = shellRef.current
    if (!el) return

    let startX = 0
    let startY = 0
    let tracking = false
    const EDGE_PX = 28
    const THRESHOLD = 52

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      if (!t) return
      const target = e.target as HTMLElement | null
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if (target?.closest?.('.reader-shell')) return
      // 侧栏自身内部不处理开闭手势（避免误触）
      if (target?.closest?.('.sidebar')) return
      // 横向货架/筛选条滑动时，勿抢成「开侧栏」
      if (target?.closest?.('[data-h-scroll], .continue-shelf, .library-filter-row, .h-shelf')) {
        tracking = mobileOpenRef.current
        startX = t.clientX
        startY = t.clientY
        return
      }
      startX = t.clientX
      startY = t.clientY
      // 只有从左缘起滑才跟踪「打开」；其它区域仅在已打开时跟踪关闭
      tracking = t.clientX <= EDGE_PX || mobileOpenRef.current
    }

    const onEnd = (e: TouchEvent) => {
      if (!tracking) return
      tracking = false
      const t = e.changedTouches[0]
      if (!t) return
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      // 略提高阈值，减少安卓惯性滑动误开侧栏
      if (Math.abs(dx) < THRESHOLD + 8 || Math.abs(dx) <= Math.abs(dy) * 1.35) return

      if (dx > 0) {
        if (mobileOpenRef.current) return
        if (startX <= EDGE_PX) setMobileOpen(true)
        return
      }

      if (mobileOpenRef.current) setMobileOpen(false)
    }

    const onCancel = () => {
      tracking = false
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onCancel, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onCancel)
    }
  }, [isCompact])

  return (
    <div className="app-shell" ref={shellRef}>
      {/* SVG Filter for Gooey Nav Indicator */}
      <svg width="0" height="0" className="absolute pointer-events-none">
        <defs>
          <filter id="gooey-nav-filter">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feColorMatrix 
              in="blur" 
              mode="matrix" 
              values="
                1 0 0 0 0  
                0 1 0 0 0  
                0 0 1 0 0  
                0 0 0 18 -7" 
              result="gooey" 
            />
            <feBlend in="SourceGraphic" in2="gooey" />
          </filter>
        </defs>
      </svg>
      <div className="mobile-topbar">
        <button className="icon-btn" onClick={() => setMobileOpen(true)} aria-label="打开菜单">
          <Menu size={20} />
        </button>
        <div className="brand brand-compact" style={{ padding: 0 }}>
          <div className="brand-title" style={{ fontSize: 16 }}>
            墨引 MoYin
          </div>
        </div>
      </div>

      {mobileOpen && <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />}

      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-text">
            <div className="brand-title-row">
              <div className="brand-title">墨引 MoYin</div>
              <span className="brand-version" title={`墨引 ${APP_VERSION_LABEL}`}>
                {APP_VERSION_LABEL}
              </span>
            </div>
            <div className="brand-subtitle">Reading · Notes · Citations</div>
          </div>
          <button className="icon-btn sidebar-close" onClick={() => setMobileOpen(false)} aria-label="关闭菜单">
            <X size={18} />
          </button>
        </div>

        <nav onClick={() => setMobileOpen(false)} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <NavItem to="/" icon={<Home size={17} />} label="首页" />
          <NavItem to="/library" icon={<LayoutGrid size={17} />} label="书库" />
          <NavItem to="/citation" icon={<Feather size={17} />} label="引用篮" />
          <NavItem to="/ai-reader" icon={<Lightbulb size={17} />} label="AI 伴读" />
          <NavItem to="/ui-settings" icon={<Settings2 size={17} />} label="界面设置" />
          {user?.role === 'admin' && <NavItem to="/admin" icon={<ShieldCheck size={17} />} label="管理后台" />}
        </nav>

        <div className="sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.display_name || user?.username}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{user?.role === 'admin' ? '管理员' : '读者'}</div>
            </div>
            <ModeToggle className="mode-toggle-compact" isDark={theme === 'dark'} onToggle={toggleTheme} />
            <button
              className="icon-btn"
              title="退出登录"
              onClick={() => {
                logout()
                navigate('/login')
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="main-area">
        {/* 小屏关闭路由过渡动画：Framer 的 opacity/clipPath 进场在 iOS 上偶发停在
           透明态，表现为 AI 伴读等页面整页空白；桌面仍保留 ink-reveal。 */}
        {skipRouteMotion ? (
          <div key={location.pathname} className="main-area-enter">
            {children}
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              className="main-area-enter"
              variants={inkRevealVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <motion.div
                className="ink-veil"
                initial={{ opacity: 0.38, scaleY: 1 }}
                animate={{ opacity: 0, scaleY: 0 }}
                transition={{ duration: 0.55, ease: easeOutExpo }}
                style={{ originY: 0 }}
                aria-hidden
              />
              {children}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  )
}
