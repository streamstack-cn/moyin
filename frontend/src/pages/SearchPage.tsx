import { Navigate, useSearchParams } from 'react-router-dom'

/** 全库检索已并入首页；保留路由以免旧书签失效 */
export default function SearchPage() {
  const [params] = useSearchParams()
  const q = params.get('q')
  return <Navigate to={q ? `/?q=${encodeURIComponent(q)}` : '/'} replace />
}
