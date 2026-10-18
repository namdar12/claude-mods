# claude-mods

Mods for [Claude Code](https://claude.com/claude-code), published as a plugin marketplace.

| Mod | What it does |
| --- | --- |
| [`mermaid-pane`](plugins/mermaid-pane) | Renders Mermaid diagrams into a side pane. Any ` ```mermaid ` block in Claude's reply opens there automatically, and Claude also gets a `show_diagram` tool. Page through them with `n`/`p`, view the source with `s`, open in the browser with `o`; reopen with `/diagrams`. |
| [`cca-quiz`](plugins/cca-quiz) | Multiple-choice practice for the Claude Certified Architect exams, shown above the prompt while Claude works. Toggle with `/quiz` (`/quiz on`, `/quiz off`, `/quiz reset`); answer with `1`–`4`. |
| [`session-park`](plugins/session-park) | `/park-all` saves and closes every open Claude Code terminal session (the one you ran it in last) so you can upgrade; `/unpark-all` reopens each one resumed in its original directory. `/park-all force` also closes sessions that are mid-turn. |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install mermaid-pane --marketplace namdar12/claude-mods
/plugin install cca-quiz --marketplace namdar12/claude-mods
/plugin install session-park --marketplace namdar12/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope is first; Enter selects it). The mod is active right away.

From a shell:

```
claude plugin install mermaid-pane --marketplace namdar12/claude-mods
claude plugin install cca-quiz --marketplace namdar12/claude-mods
claude plugin install session-park --marketplace namdar12/claude-mods
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `namdar12/claude-mods`, then **Add plugin**.

## Notes

- `mermaid-pane` renders with `npx @mermaid-js/mermaid-cli` (Node.js required; the first render downloads it) and writes diagrams to `~/.claude/mermaid-diagrams/`. Image sizing (`sips`) and "open in browser" (`open`) use macOS commands; on other systems the pane still shows the diagram source.
- kitty and Ghostty show the rendered picture (the kitty graphics protocol). Every other terminal (Warp, iTerm2, WezTerm, Terminal.app, …) gets the diagram drawn in box-drawing characters on white, its labels wrapped to fit the pane's width: widen the pane (`ctrl+x ←` in the fullscreen layout) to see more. Flowcharts, sequence, state, class and ER diagrams draw as text; other types show their source. `o` always opens the full picture in the browser.
- The text renderer is [beautiful-mermaid](https://www.npmjs.com/package/beautiful-mermaid) (MIT), vendored in `plugins/mermaid-pane/hooks/vendor/`.
- `session-park` needs its helper script on your machine (Python 3, macOS). After installing the mod, copy [`plugins/session-park/bin/claude-park`](plugins/session-park/bin/claude-park) to `~/.local/bin/claude-park` and make it executable (`chmod +x`). Restore opens one Warp tab per session, or Terminal.app windows when Warp is not installed. You can also run it from a shell: `claude-park park`, `claude-park restore`, `claude-park list`.
