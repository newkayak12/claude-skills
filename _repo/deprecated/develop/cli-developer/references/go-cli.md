# Go CLIs

## Layout

```
cmd/deployctl/main.go     // thin: build root, execute, map error to exit code
internal/cli/             // one file per command group
internal/deploy/          // logic with no cobra imports (easy to unit-test)
```

## cobra

```go
func newReleaseCmd(cfg *Config) *cobra.Command {
	var env string
	cmd := &cobra.Command{
		Use:   "release <service>",
		Short: "Release a service",
		Args:  cobra.MinimumNArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			fmt.Fprintf(c.OutOrStdout(), "releasing %s to %s\n", args[0], env)
			return nil
		},
	}
	cmd.Flags().StringVarP(&env, "env", "e", "dev", "target environment")
	return cmd
}

func main() {
	root := &cobra.Command{Use: "deployctl", SilenceUsage: true, SilenceErrors: true}
	root.PersistentFlags().String("config", "", "config file")
	root.AddCommand(newReleaseCmd(&Config{}))
	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}
```

- Prefer `RunE` over `Run` so errors flow to one place.
- `SilenceUsage: true` stops the full usage dump on runtime failures; `SilenceErrors: true` (set above) stops cobra printing the error a second time, since `main` prints it.
- Constructors that return commands (instead of package-level `init()` globals) let tests build fresh trees.
- `cmd.MarkFlagRequired("name")`, `cmd.MarkFlagsMutuallyExclusive("a", "b")` cover common validation.
- Write to `cmd.OutOrStdout()` / `cmd.ErrOrStderr()` so tests can capture output.
- Argument validators: `NoArgs`, `ExactArgs(n)`, `MinimumNArgs(n)`, `RangeArgs(a, b)`, or a custom `func(cmd, args) error`.
- `ValidArgsFunction` supplies dynamic shell completions; cobra generates bash, zsh, fish and PowerShell scripts through the `completion` subcommand.

## viper

```go
v := viper.New()
v.SetEnvPrefix("DEPLOYCTL")
v.SetEnvKeyReplacer(strings.NewReplacer("-", "_"))
v.AutomaticEnv()
v.BindPFlag("env", cmd.Flags().Lookup("env"))
v.SetConfigName("deployctl")
v.AddConfigPath(".")
if err := v.ReadInConfig(); err != nil {
	var nf viper.ConfigFileNotFoundError
	if !errors.As(err, &nf) { return err }
}
```

Viper's lookup order already matches the usual precedence: explicit Set, flag, env, config file, default. Prefer a private `viper.New()` per command tree over the global instance, and unmarshal into a struct once (`v.Unmarshal(&cfg)`) so the rest of the code never sees viper.

## Errors and exit codes

- Wrap with `fmt.Errorf("load config: %w", err)`; test with `errors.Is` / `errors.As`.
- Define a small typed error carrying an exit code; `main` unwraps it. Everything else exits 1.
- Print once, at the top, not at each layer.

## Signals

```go
ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer stop()
if err := root.ExecuteContext(ctx); err != nil { ... }
```

Read `cmd.Context()` in `RunE` and pass it into every blocking call.

## Testing

```go
root := newRoot()
var out bytes.Buffer
root.SetOut(&out); root.SetErr(&out)
root.SetArgs([]string{"release", "api", "--env", "prod"})
err := root.Execute()
```

Assert on `out.String()` and `err`. Table-drive argument sets. For the compiled binary, `exec.Command` in an integration test.

## Building and shipping

- `CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags "-s -w -X main.version=$VERSION" ./cmd/deployctl`
- `-X main.version=...` injects the version string; declare `var version = "dev"`.
- Cross-compile by setting `GOOS`/`GOARCH` (darwin, linux, windows x amd64, arm64).
- GoReleaser automates archives, checksums, and Homebrew taps; ship checksums either way.
