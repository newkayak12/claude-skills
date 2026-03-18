# Go Terminal UI (TUI) Development

Use this reference when the user specifically needs an interactive terminal UI beyond basic output. For cobra/viper CLI framework usage, see `references/go-cli.md`.

## Bubble Tea (Interactive TUI)

Modern terminal UI framework using an Elm-inspired Model-Update-View architecture.

```go
package main

import (
    "fmt"
    "os"

    tea "github.com/charmbracelet/bubbletea"
    "github.com/charmbracelet/lipgloss"
)

// Model
type model struct {
    choices  []string
    cursor   int
    selected map[int]struct{}
}

func initialModel() model {
    return model{
        choices:  []string{"TypeScript", "ESLint", "Prettier", "Jest"},
        selected: make(map[int]struct{}),
    }
}

// Init
func (m model) Init() tea.Cmd {
    return nil
}

// Update
func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
    switch msg := msg.(type) {
    case tea.KeyMsg:
        switch msg.String() {
        case "ctrl+c", "q":
            return m, tea.Quit

        case "up", "k":
            if m.cursor > 0 {
                m.cursor--
            }

        case "down", "j":
            if m.cursor < len(m.choices)-1 {
                m.cursor++
            }

        case " ":
            _, ok := m.selected[m.cursor]
            if ok {
                delete(m.selected, m.cursor)
            } else {
                m.selected[m.cursor] = struct{}{}
            }

        case "enter":
            return m, tea.Quit
        }
    }

    return m, nil
}

// View
func (m model) View() string {
    s := "Select features:\n\n"

    for i, choice := range m.choices {
        cursor := " "
        if m.cursor == i {
            cursor = ">"
        }

        checked := " "
        if _, ok := m.selected[i]; ok {
            checked = "x"
        }

        s += fmt.Sprintf("%s [%s] %s\n", cursor, checked, choice)
    }

    s += "\nPress space to select, enter to confirm, q to quit.\n"

    return s
}

func main() {
    p := tea.NewProgram(initialModel())
    if _, err := p.Run(); err != nil {
        fmt.Printf("Error: %v", err)
        os.Exit(1)
    }
}
```

## Progress Indicators

```go
package main

import (
    "fmt"
    "time"

    "github.com/schollz/progressbar/v3"
)

func main() {
    // Simple progress bar
    bar := progressbar.Default(100, "Downloading")
    for i := 0; i < 100; i++ {
        bar.Add(1)
        time.Sleep(40 * time.Millisecond)
    }

    // Custom progress bar
    bar = progressbar.NewOptions(100,
        progressbar.OptionEnableColorCodes(true),
        progressbar.OptionShowBytes(true),
        progressbar.OptionSetWidth(15),
        progressbar.OptionSetDescription("[cyan][1/3][reset] Downloading..."),
        progressbar.OptionSetTheme(progressbar.Theme{
            Saucer:        "[green]=[reset]",
            SaucerHead:    "[green]>[reset]",
            SaucerPadding: " ",
            BarStart:      "[",
            BarEnd:        "]",
        }),
    )

    for i := 0; i < 100; i++ {
        bar.Add(1)
        time.Sleep(40 * time.Millisecond)
    }
}
```

## Spinner

```go
package main

import (
    "fmt"
    "time"

    "github.com/briandowns/spinner"
)

func main() {
    s := spinner.New(spinner.CharSets[11], 100*time.Millisecond)
    s.Suffix = " Installing dependencies..."
    s.Start()

    time.Sleep(4 * time.Second)

    s.UpdateCharSet(spinner.CharSets[9])
    s.Suffix = " Processing..."
    time.Sleep(2 * time.Second)

    s.Stop()
    fmt.Println("✓ Done!")
}
```

## Colored Output

```go
package main

import (
    "github.com/fatih/color"
)

func main() {
    // Basic colors
    color.Blue("Info: Starting deployment...")
    color.Green("Success: Deployment complete!")
    color.Yellow("Warning: Deprecated flag used")
    color.Red("Error: Deployment failed")

    // Custom styles
    success := color.New(color.FgGreen, color.Bold).PrintlnFunc()
    error := color.New(color.FgRed, color.Bold).PrintlnFunc()

    success("✓ Build successful")
    error("✗ Build failed")

    // Printf-style
    color.Cyan("Processing %d files...\n", 42)

    // Disable colors for CI
    if os.Getenv("CI") != "" {
        color.NoColor = true
    }
}
```
