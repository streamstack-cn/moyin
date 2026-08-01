import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 开发模式下 Vite 会把 HMR 脚本插到 head 最前。
 * 把 charset / viewport / 首屏关键样式挪到所有脚本之前，避免手机按错误比例首绘。
 */
function mobileHeadFirst(): Plugin {
  return {
    name: 'mobile-head-first',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const picks: string[] = []
        const take = (re: RegExp) => {
          const m = html.match(re)
          if (!m) return
          picks.push(m[0])
          html = html.replace(m[0], '')
        }
        take(/<meta\s+charset=["'][^"']*["']\s*\/?>/i)
        take(/<meta\s[^>]*name=["']viewport["'][^>]*>/i)
        // 首屏关键 <style>…</style>（紧跟在 viewport 注释后的那一段）
        take(/<!--\s*首屏关键样式[\s\S]*?<\/style>/i)
        if (!picks.length) return html
        return html.replace(/<head([^>]*)>/i, `<head$1>\n    ${picks.join('\n    ')}\n`)
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), mobileHeadFirst()],
  server: {
    host: '0.0.0.0',
    port: 6173,
    strictPort: true,
    // 允许任意 Host，便于局域网访问与反向代理调试
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.MOYIN_API_PROXY || 'http://127.0.0.1:8420',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
})
