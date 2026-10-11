import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve('.')
const spec = JSON.parse(fs.readFileSync('scripts/_ledger-assets.json', 'utf8'))
const ref = path.resolve(ROOT, spec.ref)
if (!fs.existsSync(ref)) { console.error('missing ref', ref); process.exit(1) }

fs.mkdirSync('generated/ledger', { recursive: true })
for (const a of spec.assets) {
  const out = `generated/ledger/${a.name}.png`
  const prompt = `${spec.style} ${a.prompt} ${spec.neg}`
  const args = [
    'scripts/generate-image-edit.mjs',
    '--ref', spec.ref,
    '--prompt', prompt,
    '--size', a.size,
    '--quality', a.quality,
    '--out', out,
  ]
  if (a.transparent) args.push('--transparent')
  console.log(`\n=== ${a.name} (${a.size}, q=${a.quality}${a.transparent ? ', transparent' : ''}) ===`)
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: ROOT })
  console.log(`--- ${a.name} exit=${r.status} exists=${fs.existsSync(out)}`)
}
console.log('\nALL DONE')
