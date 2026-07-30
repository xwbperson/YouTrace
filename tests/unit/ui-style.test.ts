import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(
  join(process.cwd(), 'src/renderer/src/styles/global.css'),
  'utf8'
)

describe('global UI legibility contract', () => {
  it('does not reintroduce fixed micro text or retired color variables', () => {
    expect(stylesheet).not.toMatch(/font-size:\s*(?:[0-9]|1[0-2])px\s*;/)
    expect(stylesheet).not.toMatch(/var\(--(?:line|primary|primary-soft)\)/)
  })

  it('keeps standard form controls readable and visibly bounded', () => {
    expect(stylesheet).toMatch(
      /input:not\(\[type="checkbox"\][\s\S]+?border:\s*1px solid var\(--border-strong\);[\s\S]+?font-size:\s*var\(--text-base\);/
    )
    expect(stylesheet).toMatch(
      /\.capture-panel textarea\s*\{[\s\S]+?border:\s*1px solid var\(--border-strong\);/
    )
    expect(stylesheet).toMatch(
      /textarea:focus-visible,[\s\S]+?select:focus-visible[\s\S]+?box-shadow:\s*0 0 0 3px var\(--trace-soft\);/
    )
  })
})
