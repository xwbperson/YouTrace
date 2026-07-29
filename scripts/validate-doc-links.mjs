import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

const docsRoot = resolve('docs')
const files = (await readdir(docsRoot))
  .filter((name) => name.endsWith('.md'))
  .map((name) => join(docsRoot, name))
const headings = new Map()
const contents = new Map()

for (const file of files) {
  const text = await readFile(file, 'utf8')
  contents.set(file, text)
  headings.set(
    file,
    new Set(
      [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => githubAnchor(match[1]))
    )
  )
}

const failures = []
let checked = 0
for (const [file, text] of contents) {
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const raw = match[1].trim()
    if (/^(https?:|mailto:)/i.test(raw)) continue
    const [pathPart, anchorPart] = raw.split('#', 2)
    const target = pathPart
      ? resolve(dirname(file), decodeURIComponent(pathPart))
      : file
    checked += 1
    if (!contents.has(target)) {
      failures.push(`${basename(file)} -> missing ${raw}`)
      continue
    }
    if (anchorPart && !headings.get(target)?.has(decodeURIComponent(anchorPart))) {
      failures.push(`${basename(file)} -> missing anchor ${raw}`)
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`Validated ${checked} internal Markdown links across ${files.length} documents.\n`)
}

function githubAnchor(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`~!@#$%^&*()+=[\]{}\\|;:'",.<>/?，。！？：；（）【】《》]/g, '')
    .replace(/\s+/g, '-')
}
