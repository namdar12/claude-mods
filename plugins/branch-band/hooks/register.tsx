import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BranchInfo, RepoInfo } from '../types'

const info = atom({ plugin: 'branch-band', key: 'info' } as const, null)
const touched = atom({ plugin: 'branch-band', key: 'touched' } as const, [] as RepoInfo[])

const KEEP_MS = 30 * 24 * 60 * 60 * 1000

const seen = new Set<string>()
let home: string | null = null
let sessionKey: string | null = null

const CD = /(?:^|[;&|(]\s*)(?:cd|pushd)\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|)]+))/g
const GIT_C = /\bgit\s+-C\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|)]+))/g

const TRANSCRIPT_DIRS = `printf 'HOME\\t%s\\n' "$HOME"
f=$(ls "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/projects/*/"$1".jsonl 2>/dev/null | head -1)
[ -n "$f" ] || exit 0
grep '"type":"tool_use"' "$f" | grep -oE '"(file_path|command)":"([^"\\\\]|\\\\.)*"' | grep -E '^"file_path"|cd |pushd |git -C' | sort -u`

type Saved = { savedAt: number; repos: RepoInfo[] }

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1)
}

function dirname(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut <= 0 ? '/' : path.slice(0, cut)
}

function expandHome(dir: string): string | null {
  if (dir === '~' || dir.startsWith('~/')) {
    return home ? `${home}${dir.slice(1)}` : null
  }
  return dir.startsWith('~') || dir.startsWith('$') ? null : dir
}

function dirsFromCommand(command: string): string[] {
  const dirs: string[] = []
  for (const match of [...command.matchAll(CD), ...command.matchAll(GIT_C)]) {
    const dir = expandHome(match[1] ?? match[2] ?? match[3] ?? '')
    if (dir) {
      dirs.push(dir)
    }
  }
  return dirs
}

function dirsFromTool(tool: string, input: Record<string, unknown>): string[] {
  if (tool === 'Bash' && typeof input.command === 'string') {
    return dirsFromCommand(input.command)
  }
  if (typeof input.file_path === 'string') {
    return input.file_path.startsWith('/') ? [dirname(input.file_path)] : []
  }
  return []
}

function upsert(list: RepoInfo[], repo: RepoInfo): RepoInfo[] {
  const at = list.findIndex(known => known.top === repo.top)
  if (at === -1) {
    return [...list, repo]
  }
  return list.map((known, i) => (i === at ? repo : known))
}

function byRepo(list: RepoInfo[]): Array<[string, RepoInfo[]]> {
  const groups = new Map<string, RepoInfo[]>()
  for (const repo of list) {
    groups.set(repo.repo, [...(groups.get(repo.repo) ?? []), repo])
  }
  return [...groups]
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

async function save($: EngineInterface, repos: RepoInfo[]): Promise<void> {
  if (sessionKey) {
    const saved: Saved = { savedAt: await $.clock.now(), repos }
    await $.store.set(sessionKey, saved)
  }
}

async function record($: EngineInterface, found: RepoInfo[]): Promise<void> {
  const session = await read($, info)
  const fresh = found.filter(repo => repo.top !== session?.top)
  if (fresh.length === 0) {
    return
  }
  const list = await update($, touched, list => fresh.reduce(upsert, list ?? []))
  await save($, list)
}

async function noteTouched($: EngineInterface, dir: string): Promise<void> {
  const found = await probe($, dir)
  if (found) {
    await record($, [found])
  }
}

async function noteFile($: EngineInterface, path: string): Promise<void> {
  if (!path.startsWith('/') || seen.has(dirname(path))) {
    return
  }
  seen.add(dirname(path))
  try {
    await noteTouched($, dirname(path))
  } catch {}
}

async function knowHome($: EngineInterface): Promise<void> {
  if (home === null) {
    const ran = await $.process.run(['sh', '-c', 'printf %s "$HOME"'], { timeoutMs: 5000 })
    home = ran.stdout.trim() || null
  }
}

async function backfill($: EngineInterface, id: string): Promise<void> {
  const ran = await $.process.run(['sh', '-c', TRANSCRIPT_DIRS, 'sh', id], { timeoutMs: 15000 })
  const dirs = new Set<string>()
  for (const line of ran.stdout.split('\n')) {
    if (line.startsWith('HOME\t')) {
      home = line.slice(5) || home
      continue
    }
    try {
      const input = JSON.parse(`{${line}}`) as Record<string, unknown>
      for (const dir of dirsFromTool('file_path' in input ? 'Read' : 'Bash', input)) {
        dirs.add(dir)
      }
    } catch {}
  }
  const pending = [...dirs]
  const found: RepoInfo[] = []
  for (let at = 0; at < pending.length; at += 8) {
    const batch = await Promise.all(pending.slice(at, at + 8).map(dir => probe($, dir)))
    found.push(...batch.filter((repo): repo is RepoInfo => repo !== null))
  }
  await record($, found)
}

async function prune($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  for (const key of await $.store.keys()) {
    if (!key.startsWith('session:') || key === sessionKey) {
      continue
    }
    const saved = (await $.store.get(key)) as Saved | undefined
    if (!saved || now - saved.savedAt > KEEP_MS) {
      await $.store.delete(key)
    }
  }
}

async function restore($: EngineInterface): Promise<void> {
  const id = await $.session.id()
  sessionKey = `session:${id}`
  const saved = (await $.store.get(sessionKey)) as Saved | undefined
  if (saved && Array.isArray(saved.repos)) {
    await update($, touched, () => saved.repos)
  } else {
    await update($, touched, () => [])
    if ((await $.session.turns()) > 0) {
      await backfill($, id)
    }
    await save($, (await read($, touched)) ?? [])
  }
  await prune($)
}

async function refreshSession($: EngineInterface): Promise<void> {
  const session = await probe($)
  await update($, info, () => session)
  const list = (await read($, touched)) ?? []
  const present = await Promise.all(list.map(repo => $.fs.exists(repo.top)))
  if (present.some(isThere => !isThere)) {
    const kept = await update($, touched, () => list.filter((_, i) => present[i]))
    await save($, kept)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refreshSession($)
    try {
      await restore($)
    } catch {}
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refreshSession($)
    return result
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    try {
      await knowHome($)
      for (const dir of dirsFromTool('Bash', e)) {
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
        {session ? (
          <Box key="session">
            <Text dimColor>⎇ </Text>
            <Text color="cyan">{session.branch}</Text>
            <Text dimColor>
              {' '}· {session.repo}
              {session.worktree ? ` (worktree ${session.worktree})` : ''}
            </Text>
          </Box>
        ) : null}
        {byRepo(others).map(([name, checkouts]) => (
          <Box key={name} flexWrap="wrap">
            <Text dimColor>{`  ⎇ ${name}: `}</Text>
            {checkouts.flatMap((checkout, i) => [
              <Text key={`${checkout.top}:b`} color="cyan">
                {checkout.branch}
              </Text>,
              <Text key={`${checkout.top}:s`} dimColor>
                {`${checkout.worktree ? ' (wt)' : ''}${i < checkouts.length - 1 ? ', ' : ''}`}
              </Text>,
            ])}
          </Box>
        ))}
      </Box>
    )
  })
}
