import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(
  join(process.cwd(), 'src/renderer/src/styles/global.css'),
  'utf8'
)
const planningPage = readFileSync(
  join(process.cwd(), 'src/renderer/src/pages/PlanningPage.tsx'),
  'utf8'
)
const appRoot = readFileSync(
  join(process.cwd(), 'src/renderer/src/app/App.tsx'),
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

  it('keeps dialogs and their actions reachable in short windows', () => {
    expect(stylesheet).toMatch(
      /\.dialog-content\s*\{[\s\S]+?display:\s*flex;[\s\S]+?max-height:\s*calc\(100dvh - 32px\);[\s\S]+?overflow:\s*hidden;/
    )
    expect(stylesheet).toMatch(
      /\.dialog-content > \.dialog-form\s*\{[\s\S]+?flex:\s*1 1 auto;[\s\S]+?min-height:\s*0;[\s\S]+?overflow-y:\s*auto;/
    )
    expect(stylesheet).toMatch(
      /\.task-inspector-body\s*\{[\s\S]+?flex:\s*1 1 auto;[\s\S]+?overflow-y:\s*auto;/
    )
    expect(stylesheet).toMatch(
      /\.dialog-actions\.inspector-entity-actions\s*\{[\s\S]+?position:\s*absolute;[\s\S]+?bottom:\s*24px;/
    )
    expect(stylesheet).toMatch(
      /\.dialog-actions\s*\{[\s\S]+?flex:\s*none;/
    )
    expect(stylesheet).toMatch(
      /\.workspace-disconnect-actions\s*\{[\s\S]+?position:\s*sticky;[\s\S]+?bottom:\s*0;/
    )
    expect(stylesheet).toMatch(
      /@media \(max-height:\s*760px\)\s*\{[\s\S]+?\.dialog-content\s*\{[\s\S]+?max-height:\s*calc\(100dvh - 20px\);/
    )
  })

  it('keeps the planning project rail stable while project details scroll independently', () => {
    expect(planningPage).toContain("section === 'projects' ? 'planning-page-projects' : ''")
    expect(planningPage).toContain("key={selectedProjectId ?? 'no-project'}")
    expect(stylesheet).toMatch(
      /\.planning-page\.planning-page-projects\s*\{[\s\S]+?height:\s*100%;[\s\S]+?min-height:\s*0;[\s\S]+?overflow:\s*hidden;/
    )
    expect(stylesheet).toMatch(
      /\.planning-page-projects \.planning-layout\s*\{[\s\S]+?flex:\s*1 1 auto;[\s\S]+?min-height:\s*0;[\s\S]+?overflow:\s*hidden;/
    )
    expect(stylesheet).toMatch(
      /\.planning-page-projects \.project-list\s*\{[\s\S]+?overflow-y:\s*auto;/
    )
    expect(stylesheet).toMatch(
      /\.planning-page-projects \.project-workspace\s*\{[\s\S]+?overflow-y:\s*auto;/
    )
  })

  it('uses subtle auto-hiding scrollbars across application scroll regions', () => {
    expect(appRoot).toContain("document.addEventListener('scroll', revealScrollbar, true)")
    expect(appRoot).toContain("target.dataset.scrolling = 'true'")
    expect(stylesheet).toMatch(
      /\*::\-webkit-scrollbar\s*\{[\s\S]+?width:\s*8px;[\s\S]+?height:\s*8px;/
    )
    expect(stylesheet).toMatch(
      /\*\[data-scrolling='true'\]::\-webkit-scrollbar-thumb[\s\S]+?background-color:\s*color-mix\(in srgb, var\(--muted\) 52%, transparent\);/
    )
  })
})
