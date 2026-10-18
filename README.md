# claude-mods

Mods for [Claude Code](https://claude.com/claude-code), published as a plugin marketplace.

| Mod | What it does |
| --- | --- |
| [`mermaid-pane`](plugins/mermaid-pane) | Renders Mermaid diagrams into a side pane. Any ` ```mermaid ` block in Claude's reply opens there automatically, and Claude also gets a `show_diagram` tool. Page through them with `n`/`p`, view the source with `s`, open in the browser with `o`; reopen with `/diagrams`. |
| [`cca-quiz`](plugins/cca-quiz) | Multiple-choice practice for the Claude Certified Architect exams, shown above the prompt while Claude works. Toggle with `/quiz` (`/quiz on`, `/quiz off`, `/quiz reset`); answer with `1`–`4`. |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install mermaid-pane --marketplace namdar12/claude-mods
/plugin install cca-quiz --marketplace namdar12/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope is first; Enter selects it). The mod is active right away.

From a shell:

```
claude plugin install mermaid-pane --marketplace namdar12/claude-mods
claude plugin install cca-quiz --marketplace namdar12/claude-mods
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `namdar12/claude-mods`, then **Add plugin**.

## Notes

- `mermaid-pane` renders with `npx @mermaid-js/mermaid-cli` (Node.js required; the first render downloads it) and writes diagrams to `~/.claude/mermaid-diagrams/`. Image sizing (`sips`) and "open in browser" (`open`) use macOS commands; on other systems the pane still shows the diagram source.
- Inline images need a terminal that can draw them (e.g. iTerm2, Kitty, Ghostty, WezTerm).
