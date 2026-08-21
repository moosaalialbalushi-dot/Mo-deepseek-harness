/**
 * Create a release family's tags on the merged release commit, so the tag the
 * publish workflows dispatch from is derived from the tree rather than typed by
 * hand ([rationale](../../.agents/notes/implemented/process/2026-08-21-release-tag-from-the-tree.md)).
 *
 * This runs locally, after `release:dsh` or `release:vendor` has merged. It is
 * the step between the bump and every dispatch-only publish workflow — npm, the
 * documentation site, and the vendored framework all refuse a ref that is not
 * one of these tags, and none of them can create it: CI never writes to the
 * repository ([bump rationale](./bump.ts)).
 */

import { parseArgs } from 'node:util'
import { attempt, capture, isEntry, run } from './process.ts'
import { releaseFamily, type ReleaseFamily, type ReleaseMember } from './families.ts'

/** What a tag name currently points at in this clone. */
interface ExistingTag {
  /** The tag name. */
  readonly tag: string
  /** The commit it names. */
  readonly commit: string
}

/**
 * The tags this family publishes from at the versions the tree carries.
 *
 * The dsh family shares one version, so its members collapse to a single tag;
 * the vendored family tags each package separately.
 * @param family - the release family.
 * @param members - the family's members.
 * @returns The tag names, deduplicated, in member order.
 */
export function plannedTags(family: ReleaseFamily, members: readonly ReleaseMember[]): string[] {
  return [...new Set(members.map(member => family.tagFor(member)))]
}

/**
 * Assert nothing is uncommitted, because the versions this reads come from the
 * working tree while the tag names a commit: a dirty tree would tag a commit
 * that does not carry the version the tag claims.
 * @param cwd - the repository root.
 */
function verifyCleanTree(cwd: string): void {
  const dirty = capture('git', ['status', '--porcelain'], { cwd })
  if (dirty !== '') {
    throw new Error(`release tag requires a clean working tree; uncommitted changes:\n${dirty}`)
  }
}

/**
 * Assert the commit being tagged is already published on the release branch.
 *
 * This is the check the hand-typed `git tag <merge commit>` never made. A tag on
 * an unmerged commit passes every publish gate — the tree carries the version —
 * while naming a commit no reviewer approved and the public repository does not
 * carry.
 * @param head - the commit to tag.
 * @param remote - the remote holding the release branch.
 * @param branch - the release branch.
 * @param cwd - the repository root.
 */
function verifyPublished(head: string, remote: string, branch: string, cwd: string): void {
  const upstream = `refs/remotes/${remote}/${branch}`
  const resolved = attempt('git', ['rev-parse', '--verify', `${upstream}^{commit}`], { cwd })
  if (resolved.status !== 0) {
    throw new Error(`release tag cannot read ${upstream}; run: git fetch ${remote} ${branch}`)
  }
  const contained = attempt('git', ['merge-base', '--is-ancestor', head, upstream], { cwd })
  if (contained.status !== 0) {
    throw new Error(
      `release tag requires a commit already on ${remote}/${branch}, and ${head.slice(0, 10)} is not.`
      + ` Merge the release commit first, then run: git fetch ${remote} ${branch}`,
    )
  }
}

/**
 * Classify each planned tag against what this clone already has.
 * @param tags - the planned tag names.
 * @param head - the commit they would name.
 * @param cwd - the repository root.
 * @returns Tags still to create, tags already naming `head`, and tags this clone has elsewhere.
 */
export function partitionExisting(
  tags: readonly string[],
  head: string,
  cwd: string,
): { create: string[]; conflicting: ExistingTag[]; satisfied: string[] } {
  const create: string[] = []
  const conflicting: ExistingTag[] = []
  const satisfied: string[] = []
  for (const tag of tags) {
    const resolved = attempt('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], { cwd })
    if (resolved.status !== 0) {
      create.push(tag)
      continue
    }
    const commit = resolved.stdout.trim()
    // Re-running after a partial push must not fail: a tag already naming this
    // commit is the outcome this command exists to produce.
    if (commit === head) satisfied.push(tag)
    else conflicting.push({ tag, commit })
  }
  return { create, conflicting, satisfied }
}

/** Tag the family named by `--family` at HEAD; `--push` also publishes the tags. */
function main(): void {
  const { values } = parseArgs({
    options: {
      family: { type: 'string' },
      remote: { type: 'string', default: 'origin' },
      branch: { type: 'string', default: 'master' },
      push: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  })
  if (values.family === undefined) throw new Error('usage: tag.ts --family <dsh|vendor> [--push]')

  const family = releaseFamily(values.family)
  const root = process.cwd()
  const members = family.members(root)
  family.verifyVersions(members)

  const tags = plannedTags(family, members)
  const head = capture('git', ['rev-parse', 'HEAD'], { cwd: root })
  const dryRun = values['dry-run']

  verifyCleanTree(root)
  verifyPublished(head, values.remote, values.branch, root)

  const { create, conflicting, satisfied } = partitionExisting(tags, head, root)
  if (conflicting.length > 0) {
    throw new Error(
      `release tag: ${String(conflicting.length)} tag(s) already name a different commit.`
      + ' A published version is immutable, so releasing again needs a new version rather than a moved tag:\n'
      + conflicting.map(entry => `  ${entry.tag} -> ${entry.commit.slice(0, 10)} (wanted ${head.slice(0, 10)})`).join('\n'),
    )
  }

  console.log(`release tag: family ${family.id}, ${String(tags.length)} tag(s) at ${head.slice(0, 10)}:`)
  for (const tag of tags) console.log(`  ${tag}${satisfied.includes(tag) ? ' (already tagged)' : ''}`)

  if (dryRun) {
    console.log('release tag: dry run, nothing written')
    return
  }

  for (const tag of create) run('git', ['tag', '-a', tag, head, '-m', tag], { cwd: root })

  if (!values.push) {
    console.log('release tag: created locally. Publish them with:')
    console.log(`  git push ${values.remote} ${tags.join(' ')}`)
    return
  }
  run('git', ['push', values.remote, ...tags], { cwd: root })
  console.log(`release tag: pushed ${String(tags.length)} tag(s) to ${values.remote}`)
}

if (isEntry(import.meta.url)) main()
