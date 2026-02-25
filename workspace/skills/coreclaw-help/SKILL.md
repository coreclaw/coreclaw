---
name: coreclaw-help
description: "Explain Coreclaw's commands and capabilities."
always: false
---
# Coreclaw Help

Use this skill when the user asks how to use Coreclaw.

## Available Tools

- **File operations**: `fs.read`, `fs.write`, `fs.list` — read, write, and list files in the workspace.
- **Shell**: `shell.exec` — run shell commands (admin only, must be enabled).
- **Web**: `web.fetch` — fetch URLs; `web.search` — search the web (requires Brave API key).
- **Memory**: `memory.read`, `memory.write` — persistent notes (global or per-chat).
- **Messaging**: `message.send` — send messages; `chat.register` — register a chat for full storage.
- **Tasks**: `tasks.schedule` — create scheduled tasks (cron, interval, or one-time).
- **Skills**: `skills.list`, `skills.enable`, `skills.disable` — manage skill plugins.

## CLI Commands

- Type any message to chat with Coreclaw.
- `/exit` — quit the CLI.
- `/dlq list` — list dead-letter queue entries.
- `/dlq replay <id|inbound|outbound|all>` — replay dead-letter entries.

## Tips

- Use `skills.list` to see available skills, then `skills.enable <name>` to activate one.
- Use `memory.write` to save preferences or notes that persist across conversations.
- Use `tasks.schedule` to set up recurring tasks (e.g., daily summaries).
