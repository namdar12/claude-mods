import type { Register } from 'claude-code'

const SCRIPT = '~/.local/bin/claude-park'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'park-all',
      description: 'Save and close every open Claude Code terminal session (this one last) so you can upgrade',
    })
    await $.command.register({
      name: 'unpark-all',
      description: 'Reopen every parked Claude Code session, resumed where it was',
    })

    return next(e)
  })

  on('command.run', { command: 'park-all' }, async ($, e) => {
    const self = await $.session.id()
    const force = e.args.includes('force') ? ' --force' : ''
    const run = await $.process.run(['/bin/sh', '-c', `${SCRIPT} park --self ${self}${force}`])

    return { text: (run.stdout + run.stderr).trim() }
  })

  on('command.run', { command: 'unpark-all' }, async $ => {
    const run = await $.process.run(['/bin/sh', '-c', `${SCRIPT} restore`])

    return { text: (run.stdout + run.stderr).trim() }
  })
}
