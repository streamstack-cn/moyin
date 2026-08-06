import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FolderPlus } from 'lucide-react'
import { api, ApiError } from '../../api/client'
import type { BrowseResult } from '../../api/types'

export function DirectoryBrowser({ onPick }: { onPick: (absolutePath: string, folderName: string) => void }) {
  const [data, setData] = useState<BrowseResult | null>(null)
  const [currentPath, setCurrentPath] = useState('')
  const [loading, setLoading] = useState(true)

  async function load(path: string) {
    setLoading(true)
    try {
      const res = await api.get<BrowseResult>(`/api/libraries/browse?path=${encodeURIComponent(path)}`)
      setData(res)
      setCurrentPath(res.path)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '浏览目录失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const crumbs = currentPath ? currentPath.split('/').filter(Boolean) : []

  return (
    <div className="dir-browser">
      {loading ? (
        <div className="empty-state" style={{ minHeight: 120 }}>
          <div className="spinner" />
        </div>
      ) : !data?.mount_ready ? (
        <div className="empty-state" style={{ minHeight: 120, padding: 20 }}>
          <div style={{ fontSize: 13 }}>
            尚未检测到挂载目录（{data?.mount_root}）。请在 docker-compose.yml 中把宿主机电子书目录以可读写方式挂载到该路径后重启容器，例如：
          </div>
          <code style={{ fontSize: 11.5, marginTop: 8, display: 'block' }}>
            /path/to/your/ebooks:/library-source
          </code>
        </div>
      ) : (
        <>
          <div className="dir-browser-crumbs">
            <span className="dir-crumb" onClick={() => load('')}>
              根目录
            </span>
            {crumbs.map((c, i) => (
              <span key={i}>
                <span className="dir-crumb-sep">/</span>
                <span className="dir-crumb" onClick={() => load(crumbs.slice(0, i + 1).join('/'))}>
                  {c}
                </span>
              </span>
            ))}
          </div>

          {data.permission_denied && (
            <div className="empty-state" style={{ minHeight: 'auto', padding: '10px 14px', textAlign: 'left' }}>
              <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>
                读取该目录被拒绝（权限不足）。若使用 Docker Desktop / OrbStack，请在其"文件共享"设置中为宿主机路径
                （{data.mount_root}）授权后重启容器，而不是代码问题。
              </div>
            </div>
          )}
          <div className="dir-browser-list">
            {data.entries.length === 0 && !data.permission_denied && (
              <div style={{ padding: 14, fontSize: 12.5, color: 'var(--ink-faint)' }}>此目录下没有子文件夹</div>
            )}
            {data.entries.map((entry) => (
              <div key={entry.path} className="dir-browser-row" onClick={() => load(entry.path)}>
                <FolderPlus size={14} style={{ opacity: 0.6 }} />
                <span style={{ flex: 1 }}>{entry.name}</span>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={(e) => {
                    e.stopPropagation()
                    onPick(`${data.mount_root}/${entry.path}`.replace(/\/+/g, '/'), entry.name)
                  }}
                >
                  选择
                </button>
              </div>
            ))}
          </div>

          {data.path && (
            <button
              className="btn btn-sm"
              style={{ marginTop: 10 }}
              onClick={() => onPick(data.absolute_path, data.path.split('/').pop() || data.path)}
            >
              直接使用当前目录「{data.path}」
            </button>
          )}
        </>
      )}
    </div>
  )
}
