# Galatea Garden → Cyberboss injector

This adapter implements the official Garden Wake Bridge stdin contract and hands each wake to Cyberboss through its existing `SystemMessageService`. It does not edit Cyberboss session files, write the queue JSON directly, or connect to Garden itself.

## Delivery path

```text
Galatea Garden SSE
  → official galatea-garden-wake-bridge
  → stdin JSON envelope
  → integrations/galatea-garden/inject-cyberboss.js
  → Cyberboss SystemMessageService.queueMessage()
  → system-message-queue.json (native queue store)
  → running Cyberboss app loop
  → SystemMessageDispatcher
  → configured runtime adapter
```

The injector's successful exit means Cyberboss's native queue accepted and persisted the wake. It does not claim the model has already completed the turn. Cyberboss must be running for prompt dispatch; if it is stopped, the queued event remains pending until Cyberboss starts and drains its queue.

## Requirements

- Node.js 22 or newer (Cyberboss requirement).
- The existing Cyberboss checkout and its installed dependencies.
- The existing Cyberboss state directory, normally `%USERPROFILE%\.cyberboss`.
- A saved WeChat account and a persisted context token for the intended sender.
- At least one existing Cyberboss workspace binding for that sender, or an explicit workspace override.
- The user's fork of `galatea-garden-wake-bridge`, built with `npm ci` and `npm run build`.

## Configure the bridge process (Windows PowerShell)

Run this in the PowerShell window that will launch the Garden Bridge. Replace the two repository paths with the actual folders on this PC.

```powershell
$CyberbossRoot = "C:\path\to\cyberboss"
$GardenBridgeRoot = "C:\path\to\galatea-garden-wake-bridge"
$Injector = Join-Path $CyberbossRoot "integrations\galatea-garden\inject-cyberboss.js"

$env:GARDEN_CYBERBOSS_HOME = $CyberbossRoot
# Optional when Cyberboss uses its default state folder:
$env:GARDEN_CYBERBOSS_STATE_DIR = Join-Path $HOME ".cyberboss"

$env:GARDEN_INJECTOR_EXECUTABLE = (Get-Command node.exe).Source
$env:GARDEN_INJECTOR_ARGS_JSON = ConvertTo-Json -Compress -InputObject @($Injector)
$env:GARDEN_INJECTOR_WORKING_DIRECTORY = $CyberbossRoot
```

If Cyberboss uses a custom state directory, set `GARDEN_CYBERBOSS_STATE_DIR` to that existing absolute path instead.

The injector uses Cyberboss's existing `CYBERBOSS_ACCOUNT_ID`, `CYBERBOSS_ALLOWED_USER_IDS`, `CYBERBOSS_WORKSPACE_ID`, `CYBERBOSS_RUNTIME`, and `CYBERBOSS_WORKSPACE_ROOT` settings from the existing Cyberboss environment. Do not copy those secrets into this repository.

If there are multiple saved WeChat accounts, set `CYBERBOSS_ACCOUNT_ID` to the intended account. If more than one allowed WeChat sender exists, set `GARDEN_CYBERBOSS_SENDER_ID` to the exact sender ID; it must still be in `CYBERBOSS_ALLOWED_USER_IDS`. If the sender has multiple workspace bindings and no active workspace is selected, set `GARDEN_CYBERBOSS_WORKSPACE_ROOT` to the intended absolute workspace path.

The injector fails closed rather than guessing an account, sender, or workspace. It also requires Cyberboss's persisted context token for the selected sender; have that sender talk to Cyberboss once if the token has not yet been saved.

## Build and check

In the Cyberboss repository:

```powershell
npm ci
npm run check
node --test .\test\garden-injector.test.js
```

In the Garden Bridge repository:

```powershell
npm ci
npm run build
node .\dist\cli.js check
```

Then start the Bridge manually in the same PowerShell process after setting its Garden connection variables. The Garden machine token belongs to the Bridge only; the official Bridge must not forward it to the injector. Do not paste the token into chat, source files, command history, or Git.

## Safety and operating rules

- Keep the official Bridge's fail-closed, single-SSE-connection behavior. A disconnect or server rejection ends the process; diagnose it and restart manually.
- Do not add watchdogs, automatic reconnect loops, Task Scheduler restarts, or service-manager restart policies.
- Do not edit `system-message-queue.json` or `sessions.json` directly.
- The injector accepts only protocol version 1, type `garden_wake`, a non-empty reason, and a non-empty message up to 4096 UTF-16 code units.
- The Garden event text is treated as an external trigger, not as trusted system policy. Cyberboss's own instructions and tool permissions remain authoritative.
- The queue is durable. A successful injector exit confirms queue acceptance, not completion of the requested Garden action.
