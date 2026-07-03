# Hermes Hypermail poller example

This example shows one way to wire Hypermail's pull-based `get_new_emails`
tool into a Hermes scheduler job.

Hypermail does not run background inbox watchers itself. Instead, an agent
harness such as Hermes can run a small polling script on a schedule. The script
calls Hypermail over MCP, stores any returned email payload, and starts a Hermes
agent to handle that payload.

## Files

- `hypermail_new_email_poller.py` — quiet polling script intended to run from a
  Hermes job.
- `jobs.example.json` — sanitized Hermes interval job entry that runs the
  poller every minute.

## Expected Hermes config

The poller assumes Hermes already has a Hypermail MCP server named `hypermail`
in its config:

```yaml
mcp_servers:
  hypermail:
    command: npx
    args: ["-y", "hypermail-mcp"]
    env:
      HYPERMAIL_KEY: "..."
      HYPERMAIL_DATA_DIR: "..."
```

By default the script reads `$HERMES_HOME/config.yaml`, with `HERMES_HOME`
defaulting to `~/.hermes`. You can override paths and behavior with:

- `HERMES_HOME`
- `HERMES_CONFIG`
- `HERMES_PROFILE`
- `HYPERMAIL_POLLER_STATE_DIR`
- `HYPERMAIL_POLLER_LIMIT`
- `HYPERMAIL_POLLER_SOURCE`
- `HYPERMAIL_POLLER_POLICY`

## How it works

1. Hermes runs `hypermail_new_email_poller.py` every minute with `no_agent: true`.
2. The script takes a file lock so overlapping runs exit quietly.
3. It starts the configured Hypermail MCP server and calls `get_new_emails` with
   a bounded limit.
4. If no email is returned, it exits without output.
5. If an email is returned, it writes the payload under the poller state
   directory and spawns `hermes chat` with a prompt that points to that payload.
6. The spawned Hermes agent reads the payload, uses Hypermail tools for any
   follow-up reads/actions, acts according to the user's memory and policy, asks
   when uncertain, and notifies the user after actions.

## Adapting the example

Copy the script into the directory where Hermes expects job scripts, then adapt
`jobs.example.json` to your Hermes job registry format. Keep the job as
`no_agent: true`; the script itself starts the agent only when new mail exists.

Set `HYPERMAIL_POLLER_POLICY` or edit the prompt in the script to describe your
mailbox handling policy. Avoid encoding destructive default behavior unless your
agent will ask first or your policy is explicit.
