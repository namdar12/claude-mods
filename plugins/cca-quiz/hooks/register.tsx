import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Current, Score } from '../types'
import { QUESTIONS } from './questions'

const enabled = atom({ plugin: 'cca-quiz', key: 'enabled' } as const, false)
const current = atom({ plugin: 'cca-quiz', key: 'current' } as const, null)
const picked = atom({ plugin: 'cca-quiz', key: 'picked' } as const, null)
const score = atom({ plugin: 'cca-quiz', key: 'score' } as const, { right: 0, total: 0 })
const deck = atom({ plugin: 'cca-quiz', key: 'deck' } as const, [])

const REQUEUE_AFTER = 5

function shuffled<T>(list: readonly T[]): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

function questionOf(cur: Current | null) {
  return cur ? QUESTIONS.find(q => q.id === cur.id) : undefined
}

async function advance($: EngineInterface) {
  const previous = (await read($, current))?.id
  let id = ''
  await update($, deck, list => {
    const pool = list.length > 0 ? list : shuffled(QUESTIONS.map(q => q.id))
    const [first, ...rest] = pool
    if (first === undefined) return []
    if (first === previous && rest.length > 0) {
      id = rest[0]!
      return [...rest.slice(1), first]
    }
    id = first
    return rest
  })
  const next: Current = { id, order: shuffled([0, 1, 2, 3]) }
  await update($, picked, () => null)
  await update($, current, () => next)
}

async function answer($: EngineInterface, choice: number) {
  const cur = await read($, current)
  const q = questionOf(cur)
  if (!cur || !q) return
  let isFirst = false
  await update($, picked, p => {
    isFirst = p === null
    return p ?? choice
  })
  if (!isFirst) return
  const isRight = cur.order[choice] === q.answer
  await update($, score, (s: Score) => ({
    right: s.right + (isRight ? 1 : 0),
    total: s.total + 1,
  }))
  if (!isRight) {
    await update($, deck, list => [
      ...list.slice(0, REQUEUE_AFTER),
      cur.id,
      ...list.slice(REQUEUE_AFTER),
    ])
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'quiz',
      description: 'Toggle the Claude Certified Architect practice quiz shown while Claude works',
      argumentHint: '[on|off|reset]',
      immediate: true,
    })

    return next(e)
  })

  on('command.run', { command: 'quiz' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'reset') {
      await update($, score, () => ({ right: 0, total: 0 }))
      await update($, deck, () => [])
      $.ui.toast('CCA quiz: score and deck reset')

      return {}
    }

    const isOn = arg === 'on' ? true : arg === 'off' ? false : !(await read($, enabled))
    await update($, enabled, () => isOn)
    if (isOn && !questionOf(await read($, current))) {
      await advance($)
    }
    const { right, total } = await read($, score)
    $.ui.toast(
      isOn
        ? `CCA quiz on (${right}/${total}). Questions show above the prompt while Claude works; press 1-4 in the empty prompt to answer.`
        : 'CCA quiz off',
    )

    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, enabled))) {
      return next(e)
    }
    const cur = await read($, current)
    const choice = await read($, picked)
    const q = questionOf(cur)
    if (!cur || !q || (!e.props.isWorking && choice === null)) {
      return next(e)
    }
    const { right, total } = await read($, score)
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate">
          {`CCA practice · ${q.domain} · ${right}/${total} correct`}
        </Text>
        <Text bold>{q.q}</Text>
        {cur.order.map((option, i) => {
          const label = q.options[option]
          if (choice === null) {
            return (
              <Button
                key={`answer-${i + 1}`}
                plain
                hotkey={String(i + 1)}
                label={label}
                onPress={() => answer($, i)}
              />
            )
          }
          if (option === q.answer) {
            return <Text color="success">{`✓ ${i + 1}: ${label}`}</Text>
          }
          if (i === choice) {
            return <Text color="error">{`✗ ${i + 1}: ${label}`}</Text>
          }

          return <Text dimColor>{`  ${i + 1}: ${label}`}</Text>
        })}
        {choice === null ? (
          <Text dimColor>Press 1-4 in the empty prompt, or click an answer.</Text>
        ) : (
          <Box flexDirection="column">
            <Text>{q.why}</Text>
            <Button
              key="next"
              plain
              hotkey="0"
              label="Next question"
              onPress={() => advance($)}
            />
          </Box>
        )}
      </Box>
    )
  })
}
