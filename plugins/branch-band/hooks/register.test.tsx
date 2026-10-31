import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'branch-band',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 200 },
} as const

const REPOS: Record<string, { top: string; gitDir: string; common: string; branch: string }> = {
  '/r/chief': { top: '/r/chief', gitDir: '/r/chief/.git', common: '/r/chief/.git', branch: 'main' },
  '/r/gl': { top: '/r/gl', gitDir: '/r/gl/.git', common: '/r/gl/.git', branch: 'develop' },
  '/r/gl-wt/picker': {
    top: '/r/gl-wt/picker',
    gitDir: '/r/gl/.git/worktrees/picker',
    common: '/r/gl/.git',
    branch: 'feat/picker',
  },
}

function repoFor(dir: string) {
  return Object.values(REPOS).find(repo => dir === repo.top || dir.startsWith(`${repo.top}/`))
}

function engine(on: any, opts: { turns: number; saved?: unknown; transcript?: string }) {
  const store = new Map<string, unknown>()
  if (opts.saved) {
    store.set('session:abc', opts.saved)
  }
  const transcriptReads: string[] = []
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({}))
  on('tool.call', () => ({ result: {} }))
  on('command.register', () => ({ value: { command: 'branches' } }))
  on('ui.render', ($: any, e: unknown) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('session.id', () => ({ value: 'abc' }))
  on('session.turns', () => ({ value: opts.turns }))
  on('clock.now', () => ({ value: 1_000 }))
  on('fs.exists', () => ({ value: true }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_: unknown, e: { key: string }) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    const argv = e.argv
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false } })
    if (argv[0] === 'sh') {
      if (argv[argv.length - 1] === 'abc') {
        transcriptReads.push('abc')
        return ok(opts.transcript ?? '')
      }
      return ok('/home/u')
    }
    const dir = argv[1] === '-C' ? (argv[2] ?? '') : '/r/chief'
    const repo = repoFor(dir)
    if (!repo) {
      return { value: { exitCode: 128, stdout: '', stderr: 'not a repo', isStdoutTruncated: false } }
    }
    if (argv.includes('--abbrev-ref')) {
      return ok(`${repo.branch}\n`)
    }
    return ok(`${repo.top}\n${repo.gitDir}\n${repo.common}\n`)
  })
  return { store, transcriptReads }
}

async function bandText($: any): Promise<string[]> {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const keys = (await ui.findAll({ type: 'Box' })).map((box: { key?: string }) => box.key).filter(Boolean)
  const all = (await ui.findAll({ type: 'Text' })).map((t: { text: string }) => t.text).join('')
  await ui.unmount()
  return [all, ...keys]
}

test('an old chat with no saved list backfills once from the transcript and groups by repo', async ($, on) => {
  const { store, transcriptReads } = engine(on, {
    turns: 4,
    transcript: 'HOME\t/home/u\n"file_path":"/r/gl-wt/picker/app.py"\n"command":"cd /r/gl && git status"\n',
  })

  await $.session.start({ cwd: '/r/chief', surface: 'terminal', isInteractive: true })

  const [all, ...keys] = await bandText($)
  expect(transcriptReads).toHaveLength(1)
  expect(all).toContain('main')
  expect(all).toContain('  ⎇ gl: feat/picker (wt), develop')
  expect(keys).toEqual(['session', 'gl'])
  const saved = store.get('session:abc') as { repos: Array<{ top: string }> }
  expect(saved.repos.map(repo => repo.top)).toEqual(['/r/gl-wt/picker', '/r/gl'])
})

test('a resumed chat restores its saved list without reading the transcript', async ($, on) => {
  const { transcriptReads } = engine(on, {
    turns: 9,
    saved: {
      savedAt: 900,
      repos: [{ branch: 'feat/old-pick', repo: 'gl', top: '/r/gl-wt/picker', worktree: 'picker' }],
    },
  })

  await $.session.start({ cwd: '/r/chief', surface: 'terminal', isInteractive: true })

  const [all] = await bandText($)
  expect(transcriptReads).toHaveLength(0)
  expect(all).toContain('  ⎇ gl: feat/old-pick (wt)')
  expect(all).not.toContain('develop')
})

test('a new chat reads no transcript and adds a worktree as soon as it is touched', async ($, on) => {
  const { store, transcriptReads } = engine(on, { turns: 0 })

  await $.session.start({ cwd: '/r/chief', surface: 'terminal', isInteractive: true })
  expect((await bandText($))[0]).not.toContain('gl:')

  await $.tool.call({ tool: 'Read', file_path: '/r/gl-wt/picker/app.py' })
  await $.tool.call({ tool: 'Bash', command: 'cd ~/elsewhere && cd /r/chief && ls' })

  const [all] = await bandText($)
  expect(transcriptReads).toHaveLength(0)
  expect(all).toContain('  ⎇ gl: feat/picker (wt)')
  const saved = store.get('session:abc') as { repos: Array<{ top: string }> }
  expect(saved.repos.map(repo => repo.top)).toEqual(['/r/gl-wt/picker'])
})

test('/branches hides the band, remembers it, and shows it again', async ($, on) => {
  const { store } = engine(on, { turns: 0 })

  await $.session.start({ cwd: '/r/chief', surface: 'terminal', isInteractive: true })
  expect((await bandText($))[0]).toContain('main')

  const off = await $.command.run({ command: 'branches', args: '' } as never)
  expect(JSON.stringify(off)).toContain('hidden')
  expect((await bandText($))[0]).toBe('engine')
  expect(store.get('hidden')).toBe(true)

  await $.command.run({ command: 'branches', args: 'on' } as never)
  expect((await bandText($))[0]).toContain('main')
  expect(store.get('hidden')).toBe(false)
})

test('a chat started while hidden stays hidden', async ($, on) => {
  const { store } = engine(on, { turns: 0 })
  store.set('hidden', true)

  await $.session.start({ cwd: '/r/chief', surface: 'terminal', isInteractive: true })
  expect((await bandText($))[0]).toBe('engine')
})
