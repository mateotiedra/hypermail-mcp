#!/usr/bin/env python3
"""Poll Hypermail MCP for one new inbox email and hand it to Hermes.

This example is intended to run as a quiet Hermes scheduler job. It reads the
Hypermail MCP server definition from Hermes config, calls `get_new_emails`,
writes any returned email payload to disk, and spawns a Hermes agent to handle
that payload.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import yaml

HERMES_HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
CONFIG_PATH = Path(os.environ.get("HERMES_CONFIG", HERMES_HOME / "config.yaml"))
STATE_DIR = Path(os.environ.get("HYPERMAIL_POLLER_STATE_DIR", HERMES_HOME / "hypermail-poller"))
INCOMING_DIR = STATE_DIR / "incoming"
LOG_DIR = STATE_DIR / "logs"
LOCK_PATH = STATE_DIR / "poller.lock"
PROFILE = os.environ.get("HERMES_PROFILE", "default")
SOURCE = os.environ.get("HYPERMAIL_POLLER_SOURCE", "hypermail-poller")
LIMIT = int(os.environ.get("HYPERMAIL_POLLER_LIMIT", "1"))
USER_POLICY = os.environ.get(
    "HYPERMAIL_POLLER_POLICY",
    "<Add your user-specific email handling policy here.>",
)


def load_hypermail_config() -> tuple[str, list[str], dict[str, str]]:
    data = yaml.safe_load(CONFIG_PATH.read_text()) or {}
    server = ((data.get("mcp_servers") or {}).get("hypermail") or {})
    command = server.get("command")
    if not command:
        raise RuntimeError("mcp_servers.hypermail.command is missing")
    args = server.get("args") or []
    if not isinstance(args, list):
        raise RuntimeError("mcp_servers.hypermail.args must be a list")
    env = {str(k): str(v) for k, v in (server.get("env") or {}).items()}
    return str(command), [str(a) for a in args], env


async def call_get_new_emails_async() -> dict[str, Any]:
    from datetime import timedelta

    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    command, args, mcp_env = load_hypermail_config()
    env = os.environ.copy()
    env.update(mcp_env)
    server_params = StdioServerParameters(command=command, args=args, env=env)
    async with stdio_client(server_params) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            result = await session.call_tool(
                "get_new_emails",
                {"limit": LIMIT},
                read_timeout_seconds=timedelta(seconds=60),
            )
            structured = getattr(result, "structuredContent", None)
            if structured is not None:
                return structured
            content = getattr(result, "content", None) or []
            for item in content:
                text = getattr(item, "text", None)
                if text:
                    try:
                        return json.loads(text)
                    except Exception:
                        continue
            return {"count": 0, "emails": [], "errors": []}


def call_get_new_emails() -> dict[str, Any]:
    import anyio

    return anyio.run(call_get_new_emails_async)


def spawn_agent(payload_path: Path) -> None:
    prompt = f"""A Hypermail poll found one new inbox email.

The full JSON payload is saved at:
{payload_path}

Do this now:
1. Read the JSON payload.
2. Handle only the email in that payload.
3. If bodyTruncated is true or the body is insufficient, use Hypermail MCP `read_email` with the payload account/id.
4. Act according to the user's memory and policy.
5. User-specific policy placeholder:
{USER_POLICY}
6. If there is any doubt, ask the user before taking action.
7. Never permanently delete anything unless the user explicitly asks.
8. Notify the user after any action, including what you did and why.
"""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    log_file = LOG_DIR / f"agent-{stamp}.log"
    with log_file.open("ab") as log:
        subprocess.Popen(
            [
                "hermes",
                "--profile",
                PROFILE,
                "chat",
                "-Q",
                "--source",
                SOURCE,
                "-q",
                prompt,
            ],
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--print-empty", action="store_true", help="print a diagnostic line when no mail is found")
    ns = parser.parse_args()

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    INCOMING_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    with LOCK_PATH.open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0

        data = call_get_new_emails()
        if data.get("errors"):
            print(json.dumps({"errors": data.get("errors")}, ensure_ascii=False), file=sys.stderr)
        emails = data.get("emails") or []
        if not emails:
            if ns.print_empty:
                print("count=0")
            return 0

        email = emails[0]
        stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        payload_path = INCOMING_DIR / f"email-{stamp}-{os.getpid()}.json"
        payload_path.write_text(
            json.dumps({"count": 1, "emails": [email], "errors": data.get("errors") or []}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        os.chmod(payload_path, 0o600)
        spawn_agent(payload_path)

        with (LOG_DIR / "poller.log").open("a", encoding="utf-8") as log:
            log.write(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} queued {payload_path}\n")
        return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        print(f"hypermail poller error: {e}", file=sys.stderr)
        raise SystemExit(1)
