import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Diagram } from '../types'

const PANE = 'mermaid'
const TOOL = 'mcp__mermaid-pane__show_diagram'
const MMDC = ['npx', '-y', '@mermaid-js/mermaid-cli@11']
const FENCE = /```mermaid[^\n]*\n([\s\S]*?)```/g

const diagrams = atom({ plugin: 'mermaid-pane', key: 'diagrams' } as const, [] as Diagram[])
const index = atom({ plugin: 'mermaid-pane', key: 'index' } as const, 0)
const showSource = atom({ plugin: 'mermaid-pane', key: 'showSource' } as const, false)

const pending = new Set<string>()

const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export const htmlPage = (title: string, source: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui;margin:24px;background:#fff;color:#111}
@media (prefers-color-scheme:dark){body{background:#111;color:#eee}}
pre.src{background:#8881;padding:12px;overflow:auto}</style></head>
<body><h2>${escapeHtml(title)}</h2>
<pre class="mermaid">${escapeHtml(source)}</pre>
<details><summary>Source</summary><pre class="src">${escapeHtml(source)}</pre></details>
<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs'
mermaid.initialize({ startOnLoad: true, theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default' })
</script></body></html>
`

export const fitImage = (
  width: number | undefined,
  height: number | undefined,
  maxColumns: number,
  maxRows: number,
) => {
  const ratio = width && height ? height / width : 0.5
  let columns = Math.max(1, Math.min(255, maxColumns))
  let rows = Math.max(1, Math.round((columns * ratio) / 2))
  if (rows > maxRows) {
    rows = Math.max(1, maxRows)
    columns = Math.max(1, Math.min(columns, Math.round((rows * 2) / ratio)))
  }

  return { columns, rows: Math.min(255, rows) }
}

export const cleanSource = (raw: string) =>
  raw
    .replace(/^\s*```(?:mermaid)?\s*\n/, '')
    .replace(/\n\s*```\s*$/, '')
    .trim()

export const extractMermaid = (text: string) => {
  const found: { title: string; source: string }[] = []
  for (const match of text.matchAll(FENCE)) {
    const source = match[1]!.trim()
    if (!source) continue
    const before = text
      .slice(0, match.index)
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
    const label = before.at(-1) ?? ''
    const isLabel = /^(#{1,6}\s|\*\*)/.test(label) || label.endsWith(':')
    const heading = isLabel
      ? label
          .replace(/^#{1,6}\s+/, '')
          .replaceAll('**', '')
          .replace(/:$/, '')
          .trim()
      : ''
    const kind = source.split(/\s/)[0] || 'diagram'
    found.push({ title: (heading || kind).slice(0, 120), source })
  }

  return found
}

let dirPromise: Promise<string> | undefined

const diagramDir = ($: EngineInterface) => {
  dirPromise ??= $.process
    .run(['printenv', 'HOME'])
    .then(({ stdout }) => `${stdout.trim()}/.claude/mermaid-diagrams`)

  return dirPromise
}

const render = async ($: EngineInterface, title: string, source: string): Promise<Diagram> => {
  const dir = await diagramDir($)
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const base = `${dir}/${id}`
  const diagram: Diagram = { id, title, source, htmlPath: `${base}.html`, createdAt: Date.now() }

  await $.fs.write(`${base}.mmd`, source)
  await $.fs.write(diagram.htmlPath, htmlPage(title, source))

  const ran = await $.process
    .run([...MMDC, '-i', `${base}.mmd`, '-o', `${base}.png`, '-b', 'white', '-s', '2', '-q'], {
      timeoutMs: 180_000,
    })
    .catch((error: unknown) => ({ exitCode: -1, stdout: '', stderr: String(error) }))

  if (ran.exitCode !== 0 || !(await $.fs.exists(`${base}.png`))) {
    const reason = ran.stderr.trim().split('\n').slice(-6).join('\n')

    return { ...diagram, error: reason || `mermaid-cli exited ${ran.exitCode}` }
  }

  diagram.pngPath = `${base}.png`
  const size = await $.process
    .run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', diagram.pngPath])
    .catch(() => undefined)
  diagram.width = Number(size?.stdout.match(/pixelWidth: (\d+)/)?.[1]) || undefined
  diagram.height = Number(size?.stdout.match(/pixelHeight: (\d+)/)?.[1]) || undefined

  return diagram
}

const openPane = ($: EngineInterface, focus = false) =>
  $.ui.open({ id: PANE, title: 'Diagrams', ...(focus ? { focus: true as const } : {}) })

const addDiagram = async ($: EngineInterface, title: string, source: string) => {
  $.ui.status('Rendering diagram…')
  try {
    const diagram = await render($, title, source)
    const list = await update($, diagrams, all => [...all, diagram].slice(-50))
    await update($, index, () => list.length - 1)
    await update($, showSource, () => false)
    const opened = await openPane($)

    return { diagram, count: list.length, isPlaced: opened.isPlaced }
  } finally {
    $.ui.status(undefined)
  }
}

const renderAll = async ($: EngineInterface, found: { title: string; source: string }[]) => {
  for (const { title, source } of found) {
    try {
      await addDiagram($, title, source)
    } catch {
      $.ui.toast(`Diagrams: could not render "${title}"`)
    } finally {
      pending.delete(source)
    }
  }
}

const responseText = (content: readonly { type: string; [field: string]: unknown }[]) =>
  content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'diagrams',
      description: 'Open the Mermaid diagrams pane (close it with its x; reopen any time)',
    })
    await $.tool.register({
      name: 'show_diagram',
      description:
        'Render a Mermaid diagram and show it in the user\'s side "Diagrams" pane, which keeps ' +
        'every diagram of the session (they page through them; /diagrams reopens it). A ' +
        '```mermaid block in your reply is also shown there automatically, so use this tool ' +
        'when the diagram should appear only in the pane. Pass only the Mermaid source, no ``` ' +
        'fences. If the result reports a syntax error, fix the source and call again.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short title for the diagram' },
          mermaid: { type: 'string', description: 'Mermaid source, e.g. "flowchart LR\\n A-->B"' },
        },
        required: ['title', 'mermaid'],
      },
    })

    return next(e)
  })

  on('command.run', { command: 'diagrams' }, async $ => {
    const opened = await openPane($, true)
    const list = await read($, diagrams)
    const count = list.length
      ? `${list.length} diagram${list.length === 1 ? '' : 's'}`
      : 'no diagrams yet'
    const seat = opened.isPlaced ? '' : ' It is waiting for room: widen the terminal.'

    return { text: `Diagrams pane opened (${count}).${seat}` }
  })

  on('session.append', { door: 'response' }, async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId || e.message.type !== 'assistant') return stored

    try {
      const text = responseText(e.message.content)
      if (!text.includes('```mermaid')) return stored

      const known = new Set((await read($, diagrams)).map(d => d.source))
      const fresh = extractMermaid(text).filter(d => !known.has(d.source) && !pending.has(d.source))
      if (fresh.length) {
        for (const d of fresh) pending.add(d.source)
        $.clock.after(0, () => void renderAll($, fresh))
      }
    } catch {
      $.ui.status(undefined)
    }

    return stored
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const args = e as unknown as { title?: unknown; mermaid?: unknown }
    const title = String(args.title ?? 'Diagram').slice(0, 120)
    const source = cleanSource(String(args.mermaid ?? ''))
    if (!source) return { deny: 'mermaid source is empty' }

    const { diagram, count, isPlaced } = await addDiagram($, title, source)
    const seat = isPlaced ? '' : ' The pane is waiting for room; the user can run /diagrams.'

    if (diagram.error) {
      return {
        result: `Mermaid failed to render "${title}" (shown as source in the pane):\n${diagram.error}\nFix the syntax and call show_diagram again.`,
      }
    }

    return {
      result: `Rendered "${title}" in the Diagrams pane (${count} in this session). Browser view: ${diagram.htmlPath}.${seat}`,
    }
  }).catch(($, _e, next) => {
    $.ui.status(undefined)

    return { result: `show_diagram failed (${next.error.kind}): ${next.error.message ?? 'unknown error'}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const list = await read($, diagrams)
    const at = Math.min(Math.max(0, await read($, index)), Math.max(0, list.length - 1))
    const isSource = await read($, showSource)
    const columns = e.props.bodyColumns
    const bodyRows = e.props.scroll?.bodyRows ?? (e.viewport?.rows ?? 30) - 2
    const hint = e.props.isFocused ? (
      <Text dimColor wrap="wrap">
        n next · p prev · s source · o open in browser · c copy · Esc back to the prompt
      </Text>
    ) : (
      <Text dimColor wrap="wrap">
        Press ctrl+x tab to give this pane the keys (n next · p prev · o open in browser)
      </Text>
    )

    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          <Text bold>No diagrams yet</Text>
          <Text dimColor wrap="wrap">
            Ask Claude to draw one. Any ```mermaid block in a reply appears here automatically.
          </Text>
        </Box>
      )
    }

    const current = list[at]!
    const go = (delta: number) =>
      update($, index, i => Math.min(list.length - 1, Math.max(0, i + delta)))

    const controls = (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Button key="prev" label="◀ prev" hotkey="p" onPress={() => go(-1)} />
        <Button key="next" label="next ▶" hotkey="n" onPress={() => go(1)} />
        <Button
          key="source"
          label={isSource ? 'diagram' : 'source'}
          hotkey="s"
          onPress={() => update($, showSource, v => !v)}
        />
        <Button
          key="open"
          label="open in browser"
          hotkey="o"
          onPress={() => void $.process.run(['open', current.htmlPath])}
        />
        <Button
          key="copy"
          label="copy"
          hotkey="c"
          onPress={() => void $.ui.copy({ text: current.source, surface: e.surface })}
        />
      </Box>
    )

    const header = (
      <Box flexDirection="column">
        <Text bold wrap="truncate-end">
          {current.title}
        </Text>
        <Text dimColor>
          {at + 1} / {list.length} · {new Date(current.createdAt).toLocaleTimeString()}
        </Text>
      </Box>
    )

    let body
    if (current.error) {
      body = (
        <Box flexDirection="column">
          <Text color="red">Render failed:</Text>
          <Text dimColor>{current.error}</Text>
          <Code source={current.source} language="mermaid" startLine={1} />
        </Box>
      )
    } else if (isSource || !current.pngPath || e.surface !== 'terminal') {
      body = <Code source={current.source} language="mermaid" startLine={1} />
    } else {
      const { Image } = $.ui.resolve(e)
      const fit = fitImage(current.width, current.height, columns, Math.max(4, bodyRows - 7))
      body = (
        <Image
          key={current.id}
          source={{ file: current.pngPath, format: 'png' }}
          columns={fit.columns}
          rows={fit.rows}
          alt={`[${current.title}] This terminal can't draw images inline: press o to open it in the browser, s for source.`}
        />
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {header}
        {controls}
        {hint}
        {body}
      </Box>
    )
  })
}
