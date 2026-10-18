import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const quiz = (args: string) => ({
  command: 'quiz',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 120 },
})

function engineBeneath(on: On) {
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine band'] }))
  on('ui.toast', () => ({ value: undefined }))
}

const band = (isWorking: boolean) => ({
  plugin: 'cca-quiz',
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking,
    maxRows: 20,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
})

test('off by default: nothing drawn while Claude works', async ($, on) => {
  engineBeneath(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...band(true), surface })
    expect(await ui.find({ key: 'answer-1' })).toBeUndefined()
    await ui.unmount()
  }
})

test('on: asks while working, scores an answer, then advances', async ($, on) => {
  engineBeneath(on)
  const ran = await $.command.run(quiz('on'))
  expect(ran.text).toBeUndefined()

  for (const surface of ['terminal', 'desktop'] as const) {
    await $.command.run(quiz('reset'))
    const idle = await $.ui.mount({ ...band(false), surface })
    expect(await idle.find({ key: 'answer-1' })).toBeUndefined()
    await idle.unmount()

    const ui = await $.ui.mount({ ...band(true), surface })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(4)

    await ui.press({ key: 'answer-2' })
    expect(await ui.find({ key: 'answer-1' })).toBeUndefined()
    expect(await ui.find({ text: /1 correct|0\/1 correct/ })).toBeDefined()
    expect(await ui.find({ key: 'next' })).toBeDefined()

    await ui.press({ key: 'next' })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(4)
    await ui.unmount()
  }

  await $.command.run(quiz('off'))
  const ui = await $.ui.mount({ ...band(true), surface: 'terminal' })
  expect(await ui.find({ key: 'answer-1' })).toBeUndefined()
  await ui.unmount()
})
