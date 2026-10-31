import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BranchInfo, RepoInfo } from '../types'

const info = atom({ plugin: 'branch-band', key: 'info' } as const, null)
const worktree = atom({ plugin: 'branch-band', key: 'worktree' } as const, null)
const touched = atom({ plugin: 'branch-band', key: 'touched' } as const, [] as RepoInfo[])

const seen = new Set<string>()

const CD = /(?:^|[;&|(]\s*)(?:cd|pushd)\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|)]+))/g
const GIT_C = /\bgit\s+-C\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|)]+))/g

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1)
}

function dirname(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut <= 0 ? '/' : path.slice(0, cut)
}

function dirsFromCommand(command: string): string[] {
  const dirs: string[] = []
  for (const match of [...command.matchAll(CD), ...command.matchAll(GIT_C)]) {
    const dir = match[1] ?? match[2] ?? match[3]
    if (dir && !dir.startsWith('~') && !dir.startsWith('$')) {
      dirs.push(dir)
    }
  }
  return dirs.reverse()
}

async function probe($: EngineInterface, dir?: string): Promise<BranchInfo> {
  const prefix = dir ? ['-C', dir] : []
  try {
    const ran = await $.process.run(
      ['git', ...prefix, 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'],
      { timeoutMs: 5000 },
    )
    if (ran.exitCode !== 0) {
      return null
    }
    const [top, gitDir, commonDir] = ran.stdout.trim().split('\n')
    if (!top || !gitDir || !commonDir) {
      return null
    }
    const head = await $.process.run(['git', '-C', top, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 5000 })
    let branch = head.stdout.trim()
    if (branch === 'HEAD') {
      const sha = await $.process.run(['git', '-C', top, 'rev-parse', '--short', 'HEAD'], { timeoutMs: 5000 })
      branch = `detached @ ${sha.stdout.trim()}`
    }
    const isLinked = gitDir !== commonDir
    const mainTop = commonDir.endsWith('/.git') ? dirname(commonDir) : top
    return {
      branch,
      repo: basename(isLinked ? mainTop : top),
      top,
      worktree: isLinked ? basename(top) : null,
    }
  } catch {
    return null
  }
}

function upsert(list: RepoInfo[], repo: RepoInfo): RepoInfo[] {
  const at = list.findIndex(known => known.top === repo.top)
  if (at === -1) {
    return [...list, repo]
  }
  return list.map((known, i) => (i === at ? repo : known))
}

async function noteTouched($: EngineInterface, dir: string): Promise<void> {
  if (seen.has(dir)) {
    return
  }
  seen.add(dir)
  const found = await probe($, dir)
  if (!found) {
    return
  }
  const session = await read($, info)
  if (session && session.top === found.top) {
    return
  }
  await update($, touched, list => upsert(list ?? [], found))
}

async function noteFile($: EngineInterface, path: string): Promise<void> {
  if (!path.startsWith('/')) {
    return
  }
  try {
    await noteTouched($, dirname(path))
  } catch {}
}

async function refreshAll($: EngineInterface): Promise<void> {
  const session = await probe($)
  await update($, info, () => session)
  const legacy = await read($, worktree)
  const known = await read($, touched)
  const tops = [...(known ?? []), ...(legacy ? [legacy] : [])].map(repo => repo.top)
  const again = await Promise.all([...new Set(tops)].map(top => probe($, top)))
  const fresh = again.filter((repo): repo is RepoInfo => repo !== null && repo.top !== session?.top)
  await update($, touched, () => fresh.reduce(upsert, [] as RepoInfo[]))
  if (legacy) {
    await update($, worktree, () => null)
  }
}

function row(label: string, repo: RepoInfo, Box: any, Text: any, key = label) {
  return (
    <Box key={key}>
      <Text dimColor>{label} </Text>
      <Text color="cyan">{repo.branch}</Text>
      <Text dimColor>
        {' '}· {repo.repo}
        {repo.worktree ? ` (worktree ${repo.worktree})` : ''}
      </Text>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refreshAll($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refreshAll($)
    return result
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    try {
      for (const dir of dirsFromCommand(e.command).reverse()) {
        await noteTouched($, dir)
      }
    } catch {}
    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const result = await next(e)
    await noteFile($, e.file_path)
    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const result = await next(e)
    await noteFile($, e.file_path)
    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const result = await next(e)
    await noteFile($, e.file_path)
    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const session = await read($, info)
    const others = (await read($, touched)) ?? []
    if (e.props.hasSurvey || (session === null && others.length === 0)) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {session ? row('⎇', session, Box, Text) : null}
        {others.map(repo => row(`  ⎇`, repo, Box, Text, repo.top))}
      </Box>
    )
  })
}
