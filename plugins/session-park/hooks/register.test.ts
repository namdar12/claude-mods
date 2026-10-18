import { expect, test } from 'claude-code/testing'

const ran = { stdout: 'Parked 2 session(s)', stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false }

test('/park-all runs the park script for this session and shows its output', async ($, on) => {
  const calls: string[][] = []
  on('process.run', async (_$, e) => {
    calls.push([...e.argv])
    return { value: ran }
  })
  on('session.id', async () => ({ value: 'sess-123' }))
  const out = await $.command.run({ command: 'park-all', args: 'force' })
  expect(out.text).toBe('Parked 2 session(s)')
  expect(calls[0][2]).toBe('~/.local/bin/claude-park park --self sess-123 --force')
  expect(calls[0][2]).toContain('--force')
})

test('/unpark-all runs the restore script', async ($, on) => {
  const calls: string[][] = []
  on('process.run', async (_$, e) => {
    calls.push([...e.argv])
    return { value: ran }
  })
  await $.command.run({ command: 'unpark-all' })
  expect(calls[0][2]).toBe('~/.local/bin/claude-park restore')
})
