import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import './index.css'
import App from './App.tsx'
import {
  ToastCheckIcon,
  ToastCloseIcon,
  ToastInfoIcon,
  ToastWarnIcon,
} from './components/ToastIcons'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider, useTheme } from './contexts/ThemeContext'
import { bootstrapUISettingsFromStorage, UISettingsProvider } from './contexts/UISettingsContext'

/** 挂到 body，避免阅读页 transform / filter 把 fixed 锚到错误容器 */
function ThemedToaster() {
  const { theme } = useTheme()
  return createPortal(
    <Toaster
      theme={theme}
      className="moyin-toaster"
      position="top-center"
      offset={18}
      mobileOffset={14}
      gap={8}
      duration={2400}
      visibleToasts={1}
      expand={false}
      icons={{
        success: <ToastCheckIcon className="moyin-toast-glyph" />,
        error: <ToastCloseIcon className="moyin-toast-glyph" />,
        warning: <ToastWarnIcon className="moyin-toast-glyph" />,
        info: <ToastInfoIcon className="moyin-toast-glyph" />,
      }}
      toastOptions={{
        classNames: {
          toast: 'moyin-toast',
          title: 'moyin-toast__title',
          description: 'moyin-toast__desc',
          icon: 'moyin-toast__icon',
          success: 'moyin-toast--success',
          error: 'moyin-toast--error',
          warning: 'moyin-toast--warning',
          info: 'moyin-toast--info',
        },
      }}
    />,
    document.body,
  )
}

// 登录页在 Auth 完成前就要吃到本机界面偏好（配色 / 字体）
bootstrapUISettingsFromStorage()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ThemeProvider>
          <UISettingsProvider>
            <App />
            <ThemedToaster />
          </UISettingsProvider>
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
