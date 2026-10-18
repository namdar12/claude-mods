import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { cleanSource, extractMermaid, fitImage, htmlPage } from './register'

const PANE = {
  title: 'Diagrams',
  isFocused: true,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

describe('helpers', () => {
  test('fitImage keeps the aspect ratio within the box', async () => {
    expect(fitImage(1000, 250, 60, 30)).toEqual({ columns: 60, rows: 8 })
    const tall = fitImage(250, 1000, 60, 20)
    expect(tall.rows).toBe(20)
    expect(tall.columns).toBe(10)
  })

  test('htmlPage escapes the source', async () => {
    const page = htmlPage('a<b', 'flowchart LR\n A-->B</script>')
    expect(page).toContain('a&lt;b')
    expect(page).toContain('A--&gt;B&lt;/script&gt;')
  })

  test('cleanSource strips fences', async () => {
    expect(cleanSource('```mermaid\nflowchart LR\n  A --> B\n```')).toBe('flowchart LR\n  A --> B')
  })

  test('extractMermaid finds each fenced block and titles it', async () => {
    const text = [
      '## The flow',
      '',
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
      'Some prose.',
      '```mermaid',
      'sequenceDiagram',
      '  A->>B: hi',
      '```',
      '```python',
      'print(1)',
      '```',
    ].join('\n')
    const found = extractMermaid(text)
    expect(found.length).toBe(2)
    expect(found[0]).toEqual({ title: 'The flow', source: 'flowchart TD\n  A --> B' })
    expect(found[1]!.title).toBe('sequenceDiagram')
  })
})

const ran = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

const host = (on: On, renders: string[], opens: unknown[] = []) => {
  on('process.run', ($, e) => {
    if (e.argv[0] === 'printenv') return ran('/Users/me\n')
    if (e.argv[0] === 'sips') return ran('pixelWidth: 1000\npixelHeight: 250\n')
    renders.push(e.argv.join(' '))
    return ran('')
  })
  on('fs.write', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: true }))
  on('ui.open', ($, e) => {
    opens.push(e)
    return { value: { isPlaced: true as const } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
}

const draw = (title: string) => ({
  tool: 'mcp__mermaid-pane__show_diagram' as const,
  title,
  mermaid: '```mermaid\nflowchart LR\n  A --> B\n```',
})

const mount = ($: Engine, surface: 'terminal' | 'desktop', isFocused = true) =>
  $.ui.mount({
    plugin: 'mermaid-pane',
    surface,
    component: 'Pane',
    requestId: 'mermaid',
    props: { ...PANE, isFocused },
  })

describe('pane', () => {
  test('empty pane invites a diagram', async $ => {
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: /No diagrams yet/ })).toBeDefined()
    await ui.unmount()
  })

  test('a tool call renders, pages and toggles source', async ($, on) => {
    const renders: string[] = []
    host(on, renders)
    const first = await $.tool.call(draw('First'))
    expect(String(first.result)).toContain('Rendered "First"')
    await $.tool.call(draw('Second'))
    expect(renders.length).toBe(2)
    expect(renders[0]).toContain('/Users/me/.claude/mermaid-diagrams/')

    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: /Second/ })).toBeDefined()
    expect(await ui.find({ type: 'Image' })).toBeDefined()

    await ui.press({ key: 'prev' })
    expect(await ui.find({ type: 'Text', text: /First/ })).toBeDefined()

    await ui.press({ key: 'source' })
    expect(await ui.find({ type: 'Code' })).toBeDefined()
    await ui.unmount()
  })

  test('an unfocused pane says how to give it the keys', async ($, on) => {
    host(on, [])
    await $.tool.call(draw('Only'))
    const ui = await mount($, 'terminal', false)
    expect(await ui.find({ type: 'Text', text: /ctrl\+x tab/ })).toBeDefined()
    await ui.unmount()
  })

  test('desktop shows the source instead of a terminal image', async ($, on) => {
    host(on, [])
    await $.tool.call(draw('Only'))
    const ui = await mount($, 'desktop')
    expect(await ui.find({ type: 'Code' })).toBeDefined()
    await ui.unmount()
  })
})

describe('auto-detect', () => {
  const reply = (text: string, uuid: string) => ({
    message: { type: 'assistant' as const, role: 'assistant' as const, content: [{ type: 'text', text }] },
    door: 'response' as const,
    origin: { kind: 'model' as const, model: 'claude-opus-5-5' },
    uuid,
  })

  test('a mermaid block in a reply opens the pane with the diagram', async ($, on) => {
    const renders: string[] = []
    const opens: unknown[] = []
    host(on, renders, opens)
    const clock = mock.clock(on)
    mock.session(on)

    await $.session.append(reply('## Pipeline\n```mermaid\nflowchart LR\n  A --> B\n```', 'r1'))
    await clock.advance(10)

    expect(renders.length).toBe(1)
    expect(opens.length).toBe(1)
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: /Pipeline/ })).toBeDefined()
    await ui.unmount()

    await $.session.append(reply('again\n```mermaid\nflowchart LR\n  A --> B\n```', 'r2'))
    await clock.advance(10)
    expect(renders.length).toBe(1)
  })

  test('a reply without mermaid renders nothing', async ($, on) => {
    const renders: string[] = []
    host(on, renders)
    const clock = mock.clock(on)
    mock.session(on)
    await $.session.append(reply('```python\nprint(1)\n```', 'r3'))
    await clock.advance(10)
    expect(renders.length).toBe(0)
  })

  test('/diagrams asks for the keyboard', async ($, on) => {
    const opens: { focus?: true }[] = []
    host(on, [], opens)
    const out = await $.command.run({
      command: 'diagrams',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 200 },
    })
    expect(String((out as { text?: string }).text)).toContain('Diagrams pane opened')
    expect(opens[0]?.focus).toBe(true)
  })
})
