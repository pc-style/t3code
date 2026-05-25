# Pi

This guide is for people who want to use Pi Agent in T3 Code.

Pi is opt-in by default. Enable it in Settings before using it in the model picker.

## I Only Use One Pi Setup

Use the default provider.

Install and authenticate Pi normally:

```bash
npm install -g @earendil-works/pi-coding-agent
pi
```

Run `/login` inside Pi for OAuth providers such as ChatGPT/Codex, Anthropic, and GitHub Copilot.
Pi stores those credentials in `~/.pi/agent/auth.json`.

In T3 Code Settings, your Pi provider can stay like this:

```text
Display name: Pi
Binary path: pi
PI_CODING_AGENT_DIR path: empty
Session directory: empty
Launch arguments: empty
```

An empty `PI_CODING_AGENT_DIR path` means T3 Code uses Pi's default config directory.

## I Want A Separate Pi Setup

Use a separate Pi config directory.

Example:

```text
~/.pi_work
~/.pi_personal
```

Log in with the separate directory:

```bash
PI_CODING_AGENT_DIR=~/.pi_personal pi
```

Then add another Pi provider in T3 Code:

```text
Display name: Pi Personal
Binary path: pi
PI_CODING_AGENT_DIR path: ~/.pi_personal
```

T3 Code keeps continuation identity separate for different Pi config or session directories.

## Authentication Detection

T3 Code checks provider environment variables and Pi's `auth.json`.

This means local Pi OAuth logins can make matching models available in T3 Code without copying tokens
into T3 settings.

If auth status looks wrong:

1. Confirm the provider is enabled.
2. Refresh provider status.
3. Confirm `PI_CODING_AGENT_DIR path` points at the directory that contains `agent/auth.json`.
4. Run `/login` in a Pi session for the provider you want.

## Scoped Models

Pi uses `enabledModels` in `settings.json` for scoped model cycling.

T3 Code reads that list from Pi settings, adds concrete scoped models to the picker, and starts Pi
with the same patterns through `--models`.

Example `~/.pi/agent/settings.json`:

```json
{
  "enabledModels": ["openai-codex/gpt-5-codex:high", "github-copilot/gpt-5", "anthropic/*"]
}
```

Patterns such as `anthropic/*` are passed to Pi for runtime cycling. Concrete entries such as
`github-copilot/gpt-5` also appear in T3 Code's model picker.

## Launch Arguments

Use `Launch arguments` only for Pi CLI flags.

Do not put environment variable assignments in `Launch arguments`. Use the provider's Environment
variables section in Settings for API keys, tokens, endpoints, and provider-specific values.
