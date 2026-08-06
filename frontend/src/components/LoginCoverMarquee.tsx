import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'

const ROW_COUNT = 5
/** 每行封面数（再复制一份做无缝循环）；需足够宽，避免动画时露黑边 */
const PER_ROW = 26

function buildRows(covers: string[], rows: number, perRow: number): string[][] {
  const pool = covers.filter(Boolean)
  if (!pool.length) {
    return Array.from({ length: rows }, () => Array.from({ length: perRow }, () => ''))
  }
  return Array.from({ length: rows }, (_, row) => {
    const out: string[] = []
    for (let i = 0; i < perRow; i++) {
      out.push(pool[(row * 11 + i * 5) % pool.length])
    }
    return out
  })
}

function PlaceholderTiles({ count, seed }: { count: number; seed: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={`ph-${seed}-${i}`}
          className="login-marquee-tile login-marquee-tile-ph"
          style={{
            background: `linear-gradient(145deg,
              hsl(${(seed * 40 + i * 47) % 360} 32% 34%),
              hsl(${(seed * 40 + i * 47 + 40) % 360} 24% 18%))`,
          }}
          aria-hidden
        />
      ))}
    </>
  )
}

export default function LoginCoverMarquee({ enabled }: { enabled: boolean }) {
  const [covers, setCovers] = useState<string[]>([])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    api
      .get<{ covers: string[] }>('/api/auth/login-covers?limit=60')
      .then((res) => {
        if (!cancelled) setCovers(Array.isArray(res.covers) ? res.covers.filter(Boolean) : [])
      })
      .catch(() => {
        if (!cancelled) setCovers([])
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  const rows = useMemo(() => buildRows(covers, ROW_COUNT, PER_ROW), [covers])

  if (!enabled) return null

  return (
    <div className="login-marquee" aria-hidden>
      <div className="login-marquee-stage">
        {rows.map((row, idx) => {
          const dir = idx % 2 === 0 ? 'right' : 'left'
          // 更慢：约 240–320s 一轮
          const duration = 240 + idx * 20
          const loop = [...row, ...row]
          const hasCovers = row.every(Boolean)
          return (
            <div key={idx} className={`login-marquee-row dir-${dir}`}>
              <div
                className="login-marquee-track"
                style={{ animationDuration: `${duration}s` }}
              >
                {hasCovers ? (
                  loop.map((src, i) => (
                    <div key={`${idx}-${i}`} className="login-marquee-tile">
                      <img
                        src={src}
                        alt=""
                        loading={i < 8 ? 'eager' : 'lazy'}
                        decoding="async"
                        draggable={false}
                        onError={(e) => {
                          const el = e.currentTarget
                          el.style.display = 'none'
                          el.parentElement?.classList.add('login-marquee-tile-ph')
                        }}
                      />
                    </div>
                  ))
                ) : (
                  <PlaceholderTiles count={loop.length} seed={idx} />
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 苹果风景深：近处略清、远处高斯柔化，封面若隐若现 */}
      <div className="login-marquee-dof-near" />
      <div className="login-marquee-dof-mid" />
      <div className="login-marquee-dof-far" />
      <div className="login-marquee-frost" />
      <div className="login-marquee-specular" />
      <div className="login-marquee-vignette" />
      <div className="login-marquee-glow" />
    </div>
  )
}
