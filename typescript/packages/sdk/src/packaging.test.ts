import { describe, expect, test } from 'bun:test'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Publishability is a property of the workspace, not of one package: `@imogen/sdk` is only
 * installable if `@imogen/shared` is too. The checks therefore run over both manifests from
 * here rather than being split across two files that could drift apart.
 */

const workspaceRoot = resolve(import.meta.dir, '../../..')

type Manifest = {
  name: string
  version: string
  main?: string
  types?: string
  files?: string[]
  exports?: unknown
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
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

/** Positive `files` entries are prefixes: "dist" ships everything under dist/. */
function shippedBy(files: string[], path: string): boolean {
  const clean = path.replace(/^\.\//, '')
  return files
    .filter((entry) => !entry.startsWith('!'))
    .some((entry) => {
      const target = entry.replace(/^\.\//, '').replace(/\/$/, '')
      return clean === target || clean.startsWith(`${target}/`)
    })
}

/** What `npm pack` would put in the tarball, straight from npm. */
function packedPaths(root: string): string[] {
  const packed = Bun.spawnSync(['npm', 'pack', '--dry-run', '--json'], { cwd: root })
  expect(packed.exitCode).toBe(0)
  const entries = JSON.parse(packed.stdout.toString()) as [{ files: { path: string }[] }]
  return entries[0].files.map((file) => file.path)
}

const workspaceVersion = (
  JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as Manifest
).version

test('keeps the workspace on one version', () => {
  // The five ports are versioned in lockstep because they share one contract, and inside
  // typescript/ that means three manifests plus the range sdk pins shared at. Moving some
  // and not the others publishes half a release: shared at the new version, sdk rejected
  // by the registry as a duplicate of the old one.
  expect(packages.map((pkg) => pkg.manifest.version)).toEqual(packages.map(() => workspaceVersion))
})

describe.each(packages)('$manifest.name', ({ root, manifest }) => {
  test('declares no dependency npm cannot resolve', () => {
    // `npm publish` uploads the manifest verbatim. bun and pnpm rewrite `workspace:*` to a
    // real range when they publish; npm does not, so leaving the protocol here puts a
    // manifest on the registry that no installer can satisfy.
    const deps = Object.entries(manifest.dependencies ?? {})
    expect(deps.filter(([, range]) => range.startsWith('workspace:'))).toEqual([])
  })

  test('pins its workspace siblings to a version that exists', () => {
    // The exact pin is what makes the manifest publishable, and it is also what can go
    // stale: bumping shared without bumping this range would publish an sdk asking for a
    // version nobody released.
    const siblings = Object.entries(manifest.dependencies ?? {}).filter(([dep]) =>
      dep.startsWith('@imogen/'),
    )
    for (const [dep, range] of siblings) {
      const sibling = packages.find((pkg) => pkg.manifest.name === dep)
      expect(sibling?.manifest.version).toBe(range)
    }
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

  test('packs the published surface and nothing else', () => {
    // Asks npm rather than reimplementing its `files` semantics: npm is what builds the
    // tarball, and the negations that keep the suite and the build cache out of it are
    // npm's feature, not ours.
    const files = packedPaths(root)
    expect(files).toContain('dist/index.js')
    expect(files).toContain('dist/index.d.ts')
    expect(files.filter((file) => file.includes('.test.'))).toEqual([])
    expect(files.filter((file) => file.includes('tsbuildinfo'))).toEqual([])
  }, 60_000)
})

test('a plain Node consumer can install the tarballs and import them', () => {
  // The one check that exercises the whole chain the issue is about: prepack builds, npm
  // packs, and a runtime that is not bun resolves the result. Everything above asserts
  // that a file is listed somewhere; only this proves the package works.
  const consumer = mkdtempSync(join(tmpdir(), 'imogen-consumer-'))
  try {
    const modules = join(consumer, 'node_modules')
    for (const { dir, root, manifest } of packages) {
      const packed = Bun.spawnSync(['npm', 'pack', '--pack-destination', consumer], { cwd: root })
      expect(packed.exitCode).toBe(0)
      const tarball = `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`
      const target = join(modules, '@imogen', dir)
      mkdirSync(target, { recursive: true })
      const untar = Bun.spawnSync([
        'tar',
        '-xzf',
        join(consumer, tarball),
        '-C',
        target,
        '--strip-components=1',
      ])
      expect(untar.stderr.toString()).toBe('')
      expect(untar.exitCode).toBe(0)
    }
    // Copied from the workspace rather than installed, so the test needs no network. bun's
    // isolated layout puts it under the package that depends on it; a hoisted install puts
    // it at the root.
    const zod = [
      join(workspaceRoot, 'packages/shared/node_modules/zod'),
      join(workspaceRoot, 'node_modules/zod'),
    ].find((candidate) => existsSync(candidate))
    expect(zod).toBeDefined()
    cpSync(realpathSync(zod ?? ''), join(modules, 'zod'), { recursive: true })
    writeFileSync(join(consumer, 'package.json'), '{"type":"module"}\n')
    writeFileSync(
      join(consumer, 'consume.mjs'),
      [
        "import { ImogenClient } from '@imogen/sdk'",
        "import { AssetQuery } from '@imogen/shared'",
        "const client = new ImogenClient({ baseUrl: 'https://photos.example.test' })",
        "if (typeof client.assets.list !== 'function') throw new Error('sdk did not wire up assets')",
        "if (AssetQuery.parse({ limit: 5 }).limit !== 5) throw new Error('shared schema did not parse')",
        "process.stdout.write('ok')",
      ].join('\n'),
    )

    const ran = Bun.spawnSync(['node', join(consumer, 'consume.mjs')], { cwd: consumer })
    expect(ran.stderr.toString()).toBe('')
    expect(ran.stdout.toString()).toBe('ok')

    // Half the package is its types, and importing at runtime does not exercise them: the
    // declarations are what `types` points at, under the resolution a TypeScript consumer
    // actually uses.
    writeFileSync(
      join(consumer, 'consume.ts'),
      [
        "import { ImogenClient } from '@imogen/sdk'",
        "import type { Asset } from '@imogen/shared'",
        "export const client = new ImogenClient({ baseUrl: 'https://photos.example.test' })",
        'export const id = (asset: Asset): string => asset.id',
      ].join('\n'),
    )
    writeFileSync(
      join(consumer, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'nodenext',
          moduleResolution: 'nodenext',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        files: ['consume.ts'],
      }),
    )
    const typed = Bun.spawnSync([join(workspaceRoot, 'node_modules/.bin/tsc'), '-p', consumer])
    expect(typed.stdout.toString() + typed.stderr.toString()).toBe('')
    expect(typed.exitCode).toBe(0)
  } finally {
    rmSync(consumer, { recursive: true, force: true })
  }
}, 120_000)
