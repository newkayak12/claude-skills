# Go Terminal UI

Reach for a full TUI only when the user must navigate, filter, or watch live state. For one-shot commands, a spinner or progress line on stderr is lighter and keeps pipes working.

## Bubble Tea model

The Elm-style loop has three methods (Bubble Tea v1 API):

```go
type picker struct {
	envs []string
	sel  int
}

func (p picker) Init() tea.Cmd {
	return nil
}

func (p picker) Update(in tea.Msg) (tea.Model, tea.Cmd) {
	key, isKey := in.(tea.KeyMsg)
	if isKey {
		switch key.String() {
		case "q", "ctrl+c":
			return p, tea.Quit
		case "up":
			if p.sel > 0 { p.sel-- }
		case "down":
			if p.sel < len(p.envs)-1 { p.sel++ }
		}
	}
	return p, nil
}

func (p picker) View() string { return fmt.Sprint(p.envs, " selected: ", p.sel) } // render p.envs with p.sel highlighted

func main() {
	if _, err := tea.NewProgram(picker{envs: []string{"dev", "prod"}}).Run(); err != nil {
		log.Fatal(err)
	}
}
```

Rules:
- `Update` never blocks. Slow work is a `tea.Cmd` (a function returning a `tea.Msg`) that runs in the background and reports back with a message.
- State lives only in the model; `View` is a pure function of it.
- Handle `tea.WindowSizeMsg` to adapt layout.
- Ctrl+C arrives as a key message in raw mode; handle it yourself.

## Components

The `bubbles` module supplies ready parts: `spinner`, `progress`, `list`, `textinput`, `table`, `viewport`. Each is a sub-model: store it in your model, forward messages to its `Update`, and render its `View`. A spinner needs its `Tick` command returned from `Init`.

`lipgloss` handles styling (`lipgloss.NewStyle().Foreground(...).Bold(true).Render(s)`) and detects terminal colour capability.

## Non-TUI feedback

- Progress that only prints lines (`step 3/8: migrating`) is correct in CI logs; animate only when stderr is a terminal (`term.IsTerminal(int(os.Stderr.Fd()))` from `golang.org/x/term`).
- Provide a plain-output fallback flag so the same command is usable over dumb terminals and in logs.
