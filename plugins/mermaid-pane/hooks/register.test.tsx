import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import {
  cleanSource,
  collapseRows,
  fitArt,
  splitWord,
  extractMermaid,
  fitImage,
  hasKittyGraphics,
  htmlPage,
  narrowSource,
  textArt,
  wrapLabel,
} from './register'

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

  test('hasKittyGraphics knows kitty and Ghostty, not Warp', async () => {
    expect(hasKittyGraphics(GHOSTTY)).toBe(true)
    expect(hasKittyGraphics('|xterm-kitty|')).toBe(true)
    expect(hasKittyGraphics('|xterm-256color|1')).toBe(true)
    expect(hasKittyGraphics(WARP)).toBe(false)
    expect(hasKittyGraphics('iTerm.app|xterm-256color|')).toBe(false)
  })

  test('textArt draws boxes and labels, and reports what it cannot draw', async () => {
    const art = textArt('flowchart LR\n  A[Client] --> B[Server]')
    if (!('lines' in art)) throw new Error(art.error)
    expect(art.lines.join('\n')).toContain('Client')
    expect(art.lines.join('\n')).toContain('┌')
    expect(art.width).toBeGreaterThan(10)
    expect('error' in textArt('pie title X\n "a": 1')).toBe(true)
  })

  test('wrapLabel breaks on words', async () => {
    expect(wrapLabel('initialize (protocolVersion, capabilities)')).toBe('initialize<br/>(protocolVersion,<br/>capabilities)')
    expect(wrapLabel('short')).toBe('short')
  })

  test('narrowSource wraps long sequence labels and keeps the rest', async () => {
    const source = [
      'sequenceDiagram',
      '    participant H as Host App (e.g. Claude Code)',
      '    participant S as Server',
      '    H->>S: create Job: pinned runtime image + sidecars',
      '    S-->>H: ok',
      '    Note over H,S: everything here happens in one cluster',
    ].join('\n')
    const narrow = narrowSource(source).split('\n')
    expect(narrow[1]).toBe('    participant H as Host App (e.g.<br/>Claude Code)')
    expect(narrow[2]).toBe('    participant S as Server')
    expect(narrow[3]).toBe('    H->>S: create Job:<br/>pinned runtime<br/>image + sidecars')
    expect(narrow[4]).toBe('    S-->>H: ok')
    expect(narrow[5]).toBe('    Note over H,S: everything here happens in one cluster')
  })

  test('a wrapped sequence diagram fits a narrow pane', async () => {
    const art = textArt(
      'sequenceDiagram\n  participant C as MCP Client\n  participant S as MCP Server\n  C->>S: initialize (protocolVersion, capabilities)',
    )
    if (!('lines' in art)) throw new Error(art.error)
    expect(art.width).toBeLessThanOrEqual(60)
  })

  test('narrowSource wraps flowchart box and edge labels', async () => {
    const narrow = narrowSource('flowchart LR\n  A[Jira Automation webhook] -->|ticket needs a plan| B[Queue]')
    expect(narrow).toContain('[Jira Automation<br/>webhook]')
    expect(narrow).toContain('|ticket needs a<br/>plan|')
    expect(narrow).toContain('B[Queue]')
  })

  test('splitWord breaks only at / _ . - marks', async () => {
    expect(splitWord('notifications/initialized', 12)).toEqual(['notifications/', 'initialized'])
    expect(splitWord('capabilities', 8)).toEqual(['capabilities'])
    expect(splitWord('short', 12)).toEqual(['short'])
  })

  test('collapseRows packs sequence lifelines but keeps flowchart edges', async () => {
    const rows = ['┌─┐', '│ │', '│ │', '──▶', '│ │']
    expect(collapseRows(rows, true)).toEqual(['┌─┐', '──▶'])
    expect(collapseRows(rows)).toEqual(['┌─┐', '│ │', '──▶', '│ │'])
  })

  test('a message to itself is not wrapped', async () => {
    const source = 'sequenceDiagram\n  H->>H: permission check before running\n  H->>S: permission check before running'
    const [, self, other] = narrowSource(source).split('\n')
    expect(self).toBe('  H->>H: permission check before running')
    expect(other).toContain('<br/>')
  })

  test('fitArt takes the widest labels that fit, else the narrowest drawing', async () => {
    const draws: number[] = []
    const draw = (labelWidth: number) => {
      draws.push(labelWidth)
      return { lines: ['x'], width: labelWidth * 5 }
    }
    expect(fitArt(draw, 90)).toEqual({ lines: ['x'], width: 80 })
    expect(fitArt(draw, 10)).toEqual({ lines: ['x'], width: 60 })
    expect(fitArt(() => ({ error: 'no' }), 10)).toEqual({ error: 'no' })
  })

  test('a long prose line before a block is not its title', async () => {
    const prose = "Here's a sequence diagram of a full MCP tool call, from connecting to the server through to the end:"
    const [found] = extractMermaid(`${prose}\n\n\`\`\`mermaid\nsequenceDiagram\n  A->>B: hi\n\`\`\``)
    expect(found!.title).toBe('sequenceDiagram')
    const [short] = extractMermaid('The flow:\n```mermaid\nflowchart LR\n  A-->B\n```')
    expect(short!.title).toBe('The flow')
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

const WARP = 'WarpTerminal|xterm-256color|'
const GHOSTTY = 'ghostty|xterm-ghostty|'

const host = (on: On, renders: string[], opens: unknown[] = [], env = WARP) => {
  on('process.run', ($, e) => {
    if (e.argv[0] === 'printenv') return ran('/Users/me\n')
    if (e.argv[0] === 'sh') return ran(env)
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
    host(on, renders, [], GHOSTTY)
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

  test('Warp gets the diagram as text, not an image', async ($, on) => {
    host(on, [])
    await $.tool.call(draw('Text'))
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Image' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Client|A/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /┌/ })).toBeDefined()
    await ui.unmount()
  })

  test('the text view is dark ink on white paper', async ($, on) => {
    host(on, [])
    await $.tool.call(draw('Paper'))
    const ui = await mount($, 'terminal')
    const line = await ui.find({ type: 'Text', text: /┌/ })
    expect(line?.props.backgroundColor).toBe('#ffffff')
    expect(line?.props.color).toBe('#1f2328')
    await ui.unmount()
  })

  test('a diagram wider than the pane is fitted, then cut with a hint, never panned', async ($, on) => {
    host(on, [])
    const wide = Array.from({ length: 8 }, (_, i) => `N${i}[Node number ${i}]`).join(' --> ')
    await $.tool.call({ ...draw('Wide'), mermaid: `flowchart LR\n  ${wide}` })
    const ui = await mount($, 'terminal')
    expect(await ui.find({ key: 'right' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Cut at the right edge: ctrl\+x ← widens the pane/ })).toBeDefined()
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
