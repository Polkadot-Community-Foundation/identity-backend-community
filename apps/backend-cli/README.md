# Backend CLI

AI guard-rail CLI wrapper that prevents unsafe command execution in non-TTY environments. Available as `backend` in the workspace once installed.

## Why

Running `vitest` in watch mode inside a non-interactive session hangs forever. Running `stryker` without `--mutate` targets the entire project. This CLI catches both cases and blocks them with a clear error message, unless `CI=true` is set (which real CI does automatically).

## Usage

```bash
backend run --cmd "pnpm vitest run" --guard        # safe: full command, guard enabled
backend run --cmd "vitest" --guard                  # blocked: watch mode in non-TTY
backend run --cmd "npx stryker run" --stryker       # blocked: missing --mutate flag
backend run --cmd "npx playwright test" --xvfb      # wraps in xvfb-run for headless browsers
```

## Options

| Flag              | Effect                                                       |
| :---------------- | :----------------------------------------------------------- |
| `--cmd <command>` | The command to run (e.g. `pnpm vitest run`)                  |
| `--guard`         | Block watch-mode vitest and unsafe commands unless `CI=true` |
| `--xvfb`          | Wrap command in `xvfb-run -a` for headless browser tests     |
| `--stryker`       | Require `--mutate <pattern>` to run mutation testing         |

## Guards

In non-TTY environments (agent sessions, CI pipelines missing `CI=true`):

- Vitest without `run` or `--run` in args → blocked
- Stryker without `--mutate` → blocked
- Any other command without `CI=true` → blocked

`CI=true` is auto-set by real CI systems. **Never set it manually** — it bypasses all guards.
