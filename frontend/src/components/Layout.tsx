import { useState, type ReactNode } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Feather, Home, LayoutGrid, LogOut, Menu, Moon, Lightbulb, ShieldCheck, Sun, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { easeOutExpo, inkRevealVariants, mobilePageVariants, softSpring } from '../lib/motion'
import { useMediaQuery } from '../lib/useMediaQuery'
import { APP_VERSION_LABEL } from '../version'

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

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const reduceMotion = useReducedMotion()
  const isCompact = useMediaQuery('(max-width: 900px)')
  const [mobileOpen, setMobileOpen] = useState(false)
  const pageVariants = isCompact ? mobilePageVariants : inkRevealVariants

  return (
    <div className="app-shell">
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
        <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={toggleTheme} title="切换深色/浅色">
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
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
            <button className="icon-btn" title="切换深色/浅色" onClick={toggleTheme}>
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
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
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            className="main-area-enter"
            variants={reduceMotion ? undefined : pageVariants}
            initial={reduceMotion ? false : 'initial'}
            animate="animate"
            exit={reduceMotion ? undefined : 'exit'}
          >
            {/* 墨色遮罩仅桌面使用；移动端会额外拖慢首屏可见时间 */}
            {!reduceMotion && !isCompact && (
              <motion.div
                className="ink-veil"
                initial={{ opacity: 0.38, scaleY: 1 }}
                animate={{ opacity: 0, scaleY: 0 }}
                transition={{ duration: 0.55, ease: easeOutExpo }}
                style={{ originY: 0 }}
                aria-hidden
              />
            )}
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
