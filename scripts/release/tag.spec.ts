/** Release tag naming and the classification that keeps re-running the command safe. */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { releaseFamily, type ReleaseMember } from './families.ts'
import { capture } from './process.ts'
import { partitionExisting, plannedTags } from './tag.ts'

/**
 * A release member standing in for a manifest on disk.
 * @param directory - repository-relative package directory.
 * @param name - package name.
 * @param version - the version the manifest carries.
 * @returns The member.
 */
function member(directory: string, name: string, version: string): ReleaseMember {
  return { directory, name, version, manifest: {} }
}

const roots: string[] = []

/**
 * A git repository with one commit, so tag resolution has a real object to read.
 * @returns The repository root and its commit.
 */
function repository(): { root: string; commit: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-release-tag-'))
  roots.push(root)
  capture('git', ['init', '--initial-branch', 'master'], { cwd: root })
  capture('git', ['config', 'user.email', 'release@example.invalid'], { cwd: root })
  capture('git', ['config', 'user.name', 'Release'], { cwd: root })
  writeFileSync(join(root, 'package.json'), '{"version":"0.0.1"}\n')
  capture('git', ['add', 'package.json'], { cwd: root })
  capture('git', ['commit', '-m', 'initial'], { cwd: root })
  return { root, commit: capture('git', ['rev-parse', 'HEAD'], { cwd: root }) }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('release tags', () => {
  it('collapses the dsh family to the one tag its shared version publishes from', () => {
    const tags = plannedTags(releaseFamily('dsh'), [
      member('packages/core/session', '@deepseek-ai/dsh-session', '0.1.1-rc.1'),
      member('apps/cli', '@deepseek-ai/dsh', '0.1.1-rc.1'),
    ])

    expect(tags).toEqual(['dsh-v0.1.1-rc.1'])
  })

  it('tags each vendored package on its own version line', () => {
    const tags = plannedTags(releaseFamily('vendor'), [
      member('vendor/cordis', '@deepseek-ai/cordis', '4.0.1'),
      member('vendor/cosmokit', '@deepseek-ai/cosmokit', '2.1.0'),
    ])

    expect(tags).toEqual(['vendor-cordis-v4.0.1', 'vendor-cosmokit-v2.1.0'])
  })

  it('reports an absent tag as one to create', () => {
    const { root, commit } = repository()

    expect(partitionExisting(['dsh-v0.1.1-rc.1'], commit, root)).toEqual({
      create: ['dsh-v0.1.1-rc.1'],
      conflicting: [],
      satisfied: [],
    })
  })

  it('treats a tag already naming this commit as satisfied, so a rerun after a failed push succeeds', () => {
    const { root, commit } = repository()
    capture('git', ['tag', '-a', 'dsh-v0.1.1-rc.1', '-m', 'dsh-v0.1.1-rc.1'], { cwd: root })

    expect(partitionExisting(['dsh-v0.1.1-rc.1'], commit, root)).toMatchObject({
      create: [],
      conflicting: [],
      satisfied: ['dsh-v0.1.1-rc.1'],
    })
  })

  it('reports a tag naming a different commit as conflicting rather than moving it', () => {
    const { root, commit } = repository()
    capture('git', ['tag', '-a', 'dsh-v0.1.1-rc.1', '-m', 'dsh-v0.1.1-rc.1'], { cwd: root })
    writeFileSync(join(root, 'package.json'), '{"version":"0.1.1-rc.1"}\n')
    capture('git', ['commit', '--all', '-m', 'release'], { cwd: root })
    const released = capture('git', ['rev-parse', 'HEAD'], { cwd: root })

    const { create, satisfied, conflicting } = partitionExisting(['dsh-v0.1.1-rc.1'], released, root)

    expect(create).toEqual([])
    expect(satisfied).toEqual([])
    expect(conflicting).toEqual([{ tag: 'dsh-v0.1.1-rc.1', commit }])
  })
})
