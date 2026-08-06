#!/usr/bin/env node
/**
 * 构建产物体积速览（不改业务逻辑）。
 * 用法：npm run build && node scripts/chunk-report.mjs
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const distJs = join(process.cwd(), 'dist', 'assets')
try {
  const files = readdirSync(distJs)
    .filter((f) => f.endsWith('.js'))
    .map((f) => {
      const size = statSync(join(distJs, f)).size
      return { f, size, kb: (size / 1024).toFixed(1) }
    })
    .sort((a, b) => b.size - a.size)

  console.log('JS chunks (largest first):')
  for (const row of files.slice(0, 20)) {
    console.log(`  ${row.kb.padStart(8)} KB  ${row.f}`)
  }
  const total = files.reduce((s, x) => s + x.size, 0)
  console.log(`Total JS: ${(total / 1024).toFixed(1)} KB across ${files.length} files`)
} catch (e) {
  console.error('Run npm run build first. ', e.message || e)
  process.exit(1)
}
