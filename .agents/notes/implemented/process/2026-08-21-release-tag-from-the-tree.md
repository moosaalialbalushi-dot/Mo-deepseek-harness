# Agent Note: Derive the release tag from the merged tree

Status: implemented

English | [中文](2026-08-21-release-tag-from-the-tree.zh.md)

## Problem

Every publish surface this repository owns dispatches from a release tag. npm publishes from `dsh-v*`, the vendored framework from `vendor-<package>-v*`, and [the documentation site](2026-08-21-documentation-site-tag-release.md) from `dsh-v*`. `release:verify` is the one gate all three share, and it rejects a ref that is not a tag naming the version the tree carries.

Nothing created that tag. `release:dsh` wrote one version across the family's manifests and committed it, then printed `git tag <tag> <merge commit> && git push origin <tag>` for a human to retype once the commit merged. Release `0.1.1-rc.1` merged and no `dsh-v0.1.1-rc.1` tag followed, which left all three surfaces with no ref they would accept.

A missing tag fails in a shape that hides it. The publish workflows are `workflow_dispatch`-only, so the absent tag produces no failed run to read — the ref picker simply never offers it, and the deployment looks idle rather than blocked. Working around that by dispatching from `master` reaches the rejection only after checkout, `pnpm install --frozen-lockfile`, and the release scripts load: minutes of runner time to be told the ref was wrong, which is information the dispatch carried before any of it ran.

## Decision

`release:tag` derives the tags from the tree instead of asking an operator to retype them. It is the step between the bump and every dispatch, run locally after the release commit merges, and it is family-generic: `--family dsh` collapses the shared version to one tag, `--family vendor` produces one per package, and the family dimension stays in `families.ts` as [the release-sequence Agent Note](2026-08-10-npm-release-sequences.md) requires.

It refuses three states rather than producing a tag nobody can trust. An unclean working tree, because the versions it reads come from the tree while the tag names a commit. A commit that is not yet an ancestor of `origin/master`, which is the check hand-typing never made: a tag on an unmerged commit satisfies every publish gate, since the tree carries the version, while naming a commit no reviewer approved. A tag name that already resolves to a different commit, because a published version is immutable and releasing again needs a new version rather than a moved tag. A tag already naming this commit is reported as satisfied, so a rerun after a failed push completes instead of failing.

Creating the tag and pushing it are separate. `release:tag` writes annotated tags locally and prints the push command, matching `release:pack`, which prints the publish command rather than running it; `--push` performs the remote write in the same invocation.

`docs-pages.yml` rejects a ref that is not a `dsh-v*` tag as its first step, before checkout and install. `release:verify` still owns the decision and is the only gate that can make it, because the version half needs the checked-out manifests. The dispatch ref needs neither, so the guard costs seconds and reports the same rejection the run would reach minutes later. `ci-workflow.spec.ts` pins the guard ahead of the install step and pins its prefix to `releaseFamily('dsh').tagPrefix`, so a prefix written into YAML cannot drift from the family that owns it.

## Alternatives considered

**Create the tag in the bump commit.** The bump already commits, so tagging there needs no second command and no second decision to remember. It names the wrong commit: the tag must point at the merge commit, which does not exist while the bump is being authored. A tag on the pre-merge commit names history `master` does not carry, which is the state the ancestor check now rejects.

**Have CI create the tag when the release commit merges.** This removes the human step entirely and cannot be forgotten. It requires a workflow with tag-write permission on `master`, and CI never writes to this repository — the property that lets every publish gate treat the tag as an assertion a person made about a reviewed commit rather than an artifact CI derived from one.

**Fail master CI when the tree carries a version with no matching tag.** This surfaces the omission on the existing signal without new commands. Merging the release commit and creating the tag are necessarily separate acts, so the check would fail across the whole legitimate window between them — a red master that reviewers learn to clear without reading, and one that still leaves the tag uncreated.

**Ship the fail-fast guard alone.** The guard is the smaller change and addresses the symptom an operator actually meets. It converts a slow rejection into a fast one without making the tag any more likely to exist, so the deployment stays blocked in exactly the same way.

## Consequences

The tag a release publishes from is now computed from the manifests that release wrote, and the three states that would make it wrong are refused rather than discovered at publication. The bump's closing instruction names `release:tag` instead of a command to retype, so the version and its tag come from one source.

Publication still costs a deliberate human act per release, and one more command than before the split. That is the cost of keeping tag creation outside CI: `release:tag` can be skipped exactly as the hand-typed command could, and nothing in this change detects a release that merges and is never tagged. What changes is that running it cannot produce a tag on the wrong commit.

The guard duplicates the ref half of `release:verify` in YAML, where it cannot check versions and cannot be reused by the other publish workflows. `ci-workflow.spec.ts` holds the prefix to the family, but the two rejections remain separate code paths, and the npm and vendored publish workflows still pay a full install before reaching theirs.
