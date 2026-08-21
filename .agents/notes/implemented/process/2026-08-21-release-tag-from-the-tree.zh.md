# Agent Note：从已合并的树推导发布 tag

Status: implemented

[English](2026-08-21-release-tag-from-the-tree.md) | 中文

## Problem

本仓库拥有的每一个发布面都从发布 tag 上 dispatch。npm 从 `dsh-v*` 发布，被 vendor 的框架从 `vendor-<package>-v*` 发布，[文档站](2026-08-21-documentation-site-tag-release.zh.md)从 `dsh-v*` 发布。`release:verify` 是三者共用的唯一门禁，它拒绝任何不是「命名工作树所携带版本」的 tag 的 ref。

没有任何环节创建那个 tag。`release:dsh` 把一个版本写入家族的各个 manifest 并提交，然后打印 `git tag <tag> <merge commit> && git push origin <tag>`，等 commit 合并后由人重新敲一遍。`0.1.1-rc.1` 发布合并了，却没有随之出现 `dsh-v0.1.1-rc.1` tag，于是三个面都没有任何它们会接受的 ref。

缺失的 tag 以一种把自己藏起来的形态失败。发布工作流只有 `workflow_dispatch`，因此缺失的 tag 不会产生可供阅读的失败运行——ref 选择器根本不会列出它，部署看起来是闲置而不是被阻塞。改从 `master` dispatch 来绕开这一点，则要经过 checkout、`pnpm install --frozen-lockfile` 和发布脚本加载之后才会撞上拒绝：花掉数分钟 runner 时间才被告知 ref 不对，而这条信息在 dispatch 发起时就已经具备了。

## Decision

`release:tag` 从树中推导 tag，而不是要求操作者重新敲一遍。它是 bump 与每一次 dispatch 之间的那一步，在发布 commit 合并后于本地运行，并且对家族保持通用：`--family dsh` 把共享版本收敛为一个 tag，`--family vendor` 为每个包产生一个，而家族这一维度仍然只存在于 `families.ts` 中，正如[发布序列 Agent Note](2026-08-10-npm-release-sequences.zh.md) 所要求的。

它拒绝三种状态，而不是产出一个无人可信的 tag。工作树不干净，因为它读取的版本来自工作树，而 tag 命名的是一个 commit。commit 尚不是 `origin/master` 的祖先——这正是手工敲命令从未做过的检查：未合并 commit 上的 tag 能满足每一个发布门禁，因为树携带着该版本，却命名了一个没有任何审阅人批准过的 commit。tag 名已经解析到另一个 commit，因为已发布的版本不可变，再次发布需要一个新版本而不是移动 tag。已经命名当前 commit 的 tag 被报告为 satisfied，因此推送失败后重跑会顺利完成而不是失败。

创建 tag 与推送 tag 是分开的。`release:tag` 在本地写入带注释的 tag 并打印推送命令，与 `release:pack` 打印发布命令而不执行它保持一致；`--push` 则在同一次调用中完成远端写入。

`docs-pages.yml` 把「拒绝非 `dsh-v*` tag 的 ref」作为第一步，位于 checkout 和 install 之前。`release:verify` 仍然拥有这个决定，也是唯一能做出该决定的门禁，因为版本那一半需要已 checkout 的 manifest。而 dispatch ref 两者都不需要，因此这道护栏只花几秒，就报出该次运行几分钟后才会到达的同一个拒绝。`ci-workflow.spec.ts` 把这道护栏钉在 install 步骤之前，并把它的前缀钉到 `releaseFamily('dsh').tagPrefix`，因此写进 YAML 的前缀无法与拥有它的家族发生漂移。

## Alternatives considered

**在 bump commit 中创建 tag。** bump 本来就会提交，因此在那里打 tag 不需要第二条命令，也不需要记住第二个决定。它会命名错误的 commit：tag 必须指向 merge commit，而在编写 bump 时该 commit 尚不存在。打在合并前 commit 上的 tag 命名的是 `master` 并不携带的历史，而这正是祖先检查现在会拒绝的状态。

**让 CI 在发布 commit 合并时创建 tag。** 这彻底移除了人工步骤，也就不可能被遗忘。它需要一个对 `master` 具有 tag 写权限的工作流，而 CI 从不写入本仓库——正是这一性质，让每个发布门禁都能把 tag 当作「某个人针对一个已审阅 commit 做出的断言」，而不是 CI 从中推导出的产物。

**当树携带的版本没有对应 tag 时让 master CI 失败。** 这在既有信号上暴露该遗漏，无需新命令。合并发布 commit 与创建 tag 必然是分开的两个动作，因此该检查会在两者之间整个合法窗口内持续失败——一条审阅人学会不读就清掉的红色 master，而且 tag 依然没有被创建。

**只交付快速失败护栏。** 护栏是更小的改动，处理的是操作者实际遇到的症状。它把一次缓慢的拒绝变成快速的拒绝，却没有让 tag 更可能存在，因此部署仍以完全相同的方式被阻塞。

## Consequences

一次发布所依据的 tag 现在由该次发布写入的 manifest 计算得出，而三种会让它出错的状态会被拒绝，而不是在发布时才被发现。bump 的收尾提示指向 `release:tag`，而不是一条需要重新敲的命令，因此版本与它的 tag 出自同一个来源。

发布仍然需要每次一个刻意的人工动作，并且比拆分前多一条命令。这是把 tag 创建保留在 CI 之外的代价：`release:tag` 可以像原先那条手敲命令一样被跳过，本次改动也不会检测「合并了却从未打 tag」的发布。改变的是，运行它不可能在错误的 commit 上产生 tag。

这道护栏在 YAML 中重复了 `release:verify` 的 ref 那一半，而在那里它无法检查版本，也无法被其他发布工作流复用。`ci-workflow.spec.ts` 把前缀约束到家族，但两处拒绝仍是彼此独立的代码路径，npm 与 vendor 发布工作流也依然要付出一次完整 install 才能抵达各自的那一处。
