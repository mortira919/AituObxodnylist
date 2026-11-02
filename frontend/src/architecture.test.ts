// Правило зависимостей чистой архитектуры: импорты направлены только внутрь.
// presentation → application → domain; infrastructure реализует порты application.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, test } from 'vitest'

const SRC = join(__dirname)

const FORBIDDEN: Record<string, RegExp> = {
  domain: /from '(react|.*\/(application|infrastructure|presentation)\/)/,
  application: /from '(react|.*\/(infrastructure|presentation)\/)/,
  infrastructure: /from '(react|.*\/presentation\/)/,
  presentation: /from '.*\/infrastructure\//,
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}

test.each(Object.keys(FORBIDDEN))('слой %s не зависит от внешних слоёв', (layer) => {
  const violations = files(join(SRC, layer)).filter((f) => FORBIDDEN[layer].test(readFileSync(f, 'utf8')))
  expect(violations.map((f) => relative(SRC, f))).toEqual([])
})
