# Go CLI Development

## Cobra (Recommended)

Powerful CLI framework used by kubectl, hugo, docker.

```go
// cmd/root.go
package cmd

import (
    "fmt"
    "os"
    "github.com/spf13/cobra"
    "github.com/spf13/viper"
)

var (
    cfgFile string
    verbose bool
)

var rootCmd = &cobra.Command{
    Use:   "mycli",
    Short: "My awesome CLI tool",
    Long: `A longer description of your CLI application`,
    Version: "1.0.0",
}

func Execute() {
    if err := rootCmd.Execute(); err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
}

func init() {
    cobra.OnInitialize(initConfig)

    rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file")
    rootCmd.PersistentFlags().BoolVarP(&verbose, "verbose", "v", false, "verbose output")

    viper.BindPFlag("verbose", rootCmd.PersistentFlags().Lookup("verbose"))
}

func initConfig() {
    if cfgFile != "" {
        viper.SetConfigFile(cfgFile)
    } else {
        home, err := os.UserHomeDir()
        cobra.CheckErr(err)

        viper.AddConfigPath(home)
        viper.AddConfigPath(".")
        viper.SetConfigType("yaml")
        viper.SetConfigName(".mycli")
    }

    viper.AutomaticEnv()

    if err := viper.ReadInConfig(); err == nil {
        fmt.Fprintln(os.Stderr, "Using config file:", viper.ConfigFileUsed())
    }
}

// cmd/init.go
package cmd

import (
    "fmt"
    "github.com/spf13/cobra"
)

var (
    template string
    force    bool
)

var initCmd = &cobra.Command{
    Use:   "init [name]",
    Short: "Initialize a new project",
    Args:  cobra.ExactArgs(1),
    RunE: func(cmd *cobra.Command, args []string) error {
        name := args[0]
        return initProject(name, template, force)
    },
}

func init() {
    rootCmd.AddCommand(initCmd)

    initCmd.Flags().StringVarP(&template, "template", "t", "default", "Project template")
    initCmd.Flags().BoolVarP(&force, "force", "f", false, "Overwrite existing")
}

func initProject(name, template string, force bool) error {
    fmt.Printf("Creating %s from %s\n", name, template)
    return nil
}

// cmd/deploy.go
package cmd

import (
    "fmt"
    "github.com/spf13/cobra"
)

var (
    dryRun bool
)

var deployCmd = &cobra.Command{
    Use:   "deploy [environment]",
    Short: "Deploy to environment",
    Args:  cobra.ExactArgs(1),
    ValidArgs: []string{"dev", "staging", "prod"},
    RunE: func(cmd *cobra.Command, args []string) error {
        env := args[0]
        return deploy(env, dryRun)
    },
}

func init() {
    rootCmd.AddCommand(deployCmd)
    deployCmd.Flags().BoolVar(&dryRun, "dry-run", false, "Preview only")
}

func deploy(env string, dryRun bool) error {
    if dryRun {
        fmt.Printf("Would deploy to: %s\n", env)
    } else {
        fmt.Printf("Deploying to %s...\n", env)
    }
    return nil
}

// main.go
package main

import "mycli/cmd"

func main() {
    cmd.Execute()
}
```

## Viper (Configuration)

Configuration management with multiple sources.

```go
package config

import (
    "fmt"
    "github.com/spf13/viper"
)

type Config struct {
    Environment string `mapstructure:"environment"`
    Timeout     int    `mapstructure:"timeout"`
    Verbose     bool   `mapstructure:"verbose"`
    API         APIConfig `mapstructure:"api"`
}

type APIConfig struct {
    Endpoint string `mapstructure:"endpoint"`
    Token    string `mapstructure:"token"`
}

func Load() (*Config, error) {
    // Set defaults
    viper.SetDefault("environment", "development")
    viper.SetDefault("timeout", 30)
    viper.SetDefault("verbose", false)

    // Config file locations
    viper.SetConfigName("config")
    viper.SetConfigType("yaml")
    viper.AddConfigPath("/etc/mycli/")
    viper.AddConfigPath("$HOME/.config/mycli")
    viper.AddConfigPath(".")

    // Environment variables
    viper.SetEnvPrefix("MYCLI")
    viper.AutomaticEnv()

    // Read config
    if err := viper.ReadInConfig(); err != nil {
        if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
            return nil, fmt.Errorf("failed to read config: %w", err)
        }
    }

    // Unmarshal into struct
    var cfg Config
    if err := viper.Unmarshal(&cfg); err != nil {
        return nil, fmt.Errorf("failed to unmarshal config: %w", err)
    }

    return &cfg, nil
}
```

For interactive TUI (Bubble Tea MVC, progress bars, spinners, colored output), see `references/go-tui.md`.

## Error Handling

```go
package main

import (
    "errors"
    "fmt"
    "os"
    "syscall"

    "github.com/spf13/cobra"
)

var deployCmd = &cobra.Command{
    Use:   "deploy",
    Short: "Deploy application",
    RunE: func(cmd *cobra.Command, args []string) error {
        if err := deploy(); err != nil {
            return handleError(err)
        }
        return nil
    },
}

func handleError(err error) error {
    var exitCode int

    switch {
    case errors.Is(err, os.ErrPermission):
        fmt.Fprintln(os.Stderr, "Permission denied")
        fmt.Fprintln(os.Stderr, "Try running with sudo or check file permissions")
        exitCode = 77

    case errors.Is(err, os.ErrNotExist):
        fmt.Fprintf(os.Stderr, "File not found: %v\n", err)
        exitCode = 127

    default:
        fmt.Fprintf(os.Stderr, "Deployment failed: %v\n", err)
        if os.Getenv("DEBUG") != "" {
            fmt.Fprintf(os.Stderr, "%+v\n", err)
        }
        exitCode = 1
    }

    os.Exit(exitCode)
    return nil
}

// Handle SIGINT (Ctrl+C)
func main() {
    // Setup signal handling
    c := make(chan os.Signal, 1)
    signal.Notify(c, os.Interrupt, syscall.SIGTERM)

    go func() {
        <-c
        fmt.Println("\nOperation cancelled")
        os.Exit(130)
    }()

    cmd.Execute()
}
```

## Testing

```go
package cmd

import (
    "bytes"
    "testing"

    "github.com/spf13/cobra"
    "github.com/stretchr/testify/assert"
)

func TestInitCommand(t *testing.T) {
    cmd := &cobra.Command{Use: "test"}
    cmd.AddCommand(initCmd)

    b := bytes.NewBufferString("")
    cmd.SetOut(b)
    cmd.SetArgs([]string{"init", "my-project"})

    err := cmd.Execute()
    assert.NoError(t, err)
    assert.Contains(t, b.String(), "Creating my-project")
}

func TestInitWithTemplate(t *testing.T) {
    cmd := &cobra.Command{Use: "test"}
    cmd.AddCommand(initCmd)

    b := bytes.NewBufferString("")
    cmd.SetOut(b)
    cmd.SetArgs([]string{"init", "my-project", "--template", "react"})

    err := cmd.Execute()
    assert.NoError(t, err)
    assert.Contains(t, b.String(), "react")
}
```

## Build & Distribution

```makefile
# Makefile
VERSION := $(shell git describe --tags --always --dirty)
LDFLAGS := -ldflags "-X main.version=$(VERSION)"

.PHONY: build
build:
	go build $(LDFLAGS) -o bin/mycli main.go

.PHONY: install
install:
	go install $(LDFLAGS)

.PHONY: test
test:
	go test -v ./...

.PHONY: release
release:
	GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o bin/mycli-linux-amd64
	GOOS=darwin GOARCH=amd64 go build $(LDFLAGS) -o bin/mycli-darwin-amd64
	GOOS=darwin GOARCH=arm64 go build $(LDFLAGS) -o bin/mycli-darwin-arm64
	GOOS=windows GOARCH=amd64 go build $(LDFLAGS) -o bin/mycli-windows-amd64.exe
```
