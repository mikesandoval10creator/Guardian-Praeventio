# Native lone-worker evidence matrix

This document is the physical-evidence gate for the P0 lone-worker slice. The
native implementation and unit/build checks do **not** close the P0 by themselves; each scenario below needs an Android run with captured evidence.

## Required evidence

| Scenario | Device/API | Expected observation | Authoritative evidence |
|---|---|---|---|
| Session start | API 34+ emulator or device | `NativeLoneWorkerForegroundService` starts with a `location` FGS notification | logcat + merged manifest + notification screenshot |
| Screen off / pocket | API 34+ | heartbeat events continue while the screen is locked | server `lone_worker_heartbeat_events` rows with server timestamps |
| Navigate away | API 34+ | leaving `/lone-worker/check-in` does not stop the service | notification remains + heartbeat rows continue |
| WebView/process death | API 34+ | native service and WorkManager outbox continue without the WebView | kill WebView/process, then server rows and outbox delivery |
| Offline then reconnect | API 34+ | pulses are queued before transport and delivered once after reconnect | network trace + identical `clientEventId`/single server event |
| Explicit end-session | API 34+ | capability is revoked and queued retries become scrubbed dead letters | ended session fields + `409`/dead-letter evidence; no later heartbeat |
| Device reboot | API 34+ and API 36+ | boot receiver attempts restoration only while capability is valid | boot logcat + service notification + heartbeat rows |
| Aggressive OEM policy | Xiaomi/Huawei/Samsung/OnePlus target | battery-exemption prompt behavior is observed and documented | device model, OS build, settings state, logcat, heartbeat continuity |
| Permission denial | API 34+ | start fails visibly; no false “protected” claim is shown | UI/logcat error and absence of native heartbeat rows |

## Boundaries

- A real Android run is required; TypeScript tests and `compileDebugJavaWithJavac`
  only prove the code compiles and the deterministic contracts hold.
- A user force-stop is not represented as a recoverable guarantee. Android keeps
  force-stopped applications from restarting until the user opens them again.
- Never store Firebase tokens, API keys, passwords, or connection strings in
  evidence. Redact opaque capabilities as `[REDACTED]` in exported artifacts.
- Do not move the Notion ticket to `Verified` until every required scenario has
  an attributable artifact and the evidence has been reviewed under the VIDA
  human gate.
