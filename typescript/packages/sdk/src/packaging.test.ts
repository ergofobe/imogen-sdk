import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Publishability is a property of the workspace, not of one package: `@imogen/sdk` is only
 * installable if `@imogen/shared` is too. The checks therefore run over both manifests from
 * here rather than being split across two files that could drift apart.
 */

const workspaceRoot = resolve(import.meta.dir, '../../..')
const tsc = join(workspaceRoot, 'node_modules/.bin/tsc')

type Manifest = {
  name: string
  main?: string
  types?: string
  files?: string[]
  exports?: unknown
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const packages = ['shared', 'sdk'].map((dir) => {
  const root = join(workspaceRoot, 'packages', dir)
  return {
    dir,
    root,
    manifest: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest,
  }
})

/** Every string leaf of an `exports` map is a path the tarball has to contain. */
function exportedPaths(node: unknown): string[] {
  if (typeof node === 'string') return [node]
  if (node && typeof node === 'object') return Object.values(node).flatMap(exportedPaths)
  return []
}

/** `files` entries are prefixes: "dist" ships everything under dist/. */
function shippedBy(files: string[], path: string): boolean {
  const clean = path.replace(/^\.\//, '')
  return files.some((entry) => {
    const target = entry.replace(/^\.\//, '').replace(/\/$/, '')
    return clean === target || clean.startsWith(`${target}/`)
  })
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

describe.each(packages)('$manifest.name', ({ root, manifest }) => {
  test('declares no dependency npm cannot resolve', () => {
    // `npm publish` uploads the manifest verbatim. bun and pnpm rewrite `workspace:*` to a
    // real range when they publish; npm does not, so leaving the protocol here puts a
    // manifest on the registry that no installer can satisfy.
    const deps = Object.entries(manifest.dependencies ?? {})
    expect(deps.filter(([, range]) => range.startsWith('workspace:'))).toEqual([])
  })

  test('ships every path it advertises', () => {
    const files = manifest.files ?? []
    expect(files.length).toBeGreaterThan(0)
    const advertised = [manifest.main, manifest.types, ...exportedPaths(manifest.exports)].filter(
      (path): path is string => typeof path === 'string',
    )
    expect(advertised.length).toBeGreaterThan(0)
    expect(advertised.filter((path) => !shippedBy(files, path))).toEqual([])
  })

  test('cannot be packed without building first', () => {
    // The publish scripts predate the build. Without a lifecycle hook, `npm publish` on a
    // clean checkout uploads a package whose entrypoints do not exist yet.
    const scripts = manifest.scripts ?? {}
    expect(scripts.prepack).toBeDefined()
    expect(scripts.build).toBeDefined()
    expect(scripts.build).not.toMatch(/^echo\b/)
  })

  test('emits JavaScript a plain Node consumer can import', () => {
    // Builds into the package's own dist rather than a scratch directory, so the assertions
    // land on exactly the files `npm pack` would put in the tarball. `tsc -b` is incremental
    // and builds the referenced projects, so this is cheap and needs no ordering with verify.
    const built = Bun.spawnSync([tsc, '-b', join(root, 'tsconfig.build.json')], { cwd: root })
    expect(built.stdout.toString() + built.stderr.toString()).toBe('')
    expect(built.exitCode).toBe(0)

    const dist = join(root, 'dist')
    expect(existsSync(join(dist, 'index.js'))).toBe(true)
    expect(existsSync(join(dist, 'index.d.ts'))).toBe(true)

    const emitted = walk(dist)
    // Tests are not part of the published surface.
    expect(emitted.filter((file) => file.includes('.test.'))).toEqual([])

    // A '.ts' specifier resolves under bun and nowhere else. tsc rewrites them in the
    // JavaScript emit but not in the declarations, so one reaching the output means the
    // types are broken for every consumer that is not bun.
    const dangling = emitted
      .filter((file) => file.endsWith('.js') || file.endsWith('.d.ts'))
      .filter((file) => /from '\.[^']*\.ts'/.test(readFileSync(file, 'utf8')))
    expect(dangling).toEqual([])
  }, 30_000)

  test('packs the published surface and nothing else', () => {
    // Asks npm rather than reimplementing its `files` semantics: npm is what builds the
    // tarball, and the negation pattern that keeps the suite out of it is npm's feature.
    const packed = Bun.spawnSync(['npm', 'pack', '--dry-run', '--json'], { cwd: root })
    expect(packed.exitCode).toBe(0)
    const entries = JSON.parse(packed.stdout.toString()) as [{ files: { path: string }[] }]
    const files = entries[0].files.map((file) => file.path)

    expect(files).toContain('dist/index.js')
    expect(files).toContain('dist/index.d.ts')
    // src ships so the "bun" condition still resolves once published. The suite does not.
    expect(files.filter((file) => file.includes('.test.'))).toEqual([])
  }, 60_000)
})
