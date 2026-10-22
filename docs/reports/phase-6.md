# Phase 6 report: offline PWA

**Status: complete in Chromium.** It is tested end to end with Playwright's offline mode. iPhone home-screen behaviour has not been tested on a real device, and the iOS limits below come from Apple's platform rules.

## Completed

- **Downloads.** Episodes download into IndexedDB. Each is kept only after its size, MP3 signature and decoded length all check out. The app requests persistent storage and checks free space first. Records whose files the browser evicted are pruned at start-up.
- **Offline playback.** Downloads play from the local copy with no connection, including seek, speed, progress and completion. The app shell comes from the service worker.
- **Offline-first changes.** Progress, favourites and ratings apply on the device at once, using the same conflict rules as the server, and queue in an outbox. The outbox sends on launch, reconnect, return to the foreground and every minute while open. It keeps items on network or auth failures and drops ones the server rejects.
- **Offline screens.** The Downloads tab shows storage used. An offline banner appears, Settings shows downloads and storage, and the library falls back to downloads.
- **Updates.** A new release is offered only while nothing is playing, so an update never cuts off listening.

## iOS notes

Safari does not sync installed web apps in the background. ThinkMade syncs whenever it is opened or comes back to the foreground, and the Help page says so. iOS may also clear stored data under storage pressure, so downloads are checked before being shown as available.

## Tests

Unit tests cover downloads and verification, the outbox and coalescing, and flush ordering. An end-to-end test downloads an episode, goes offline, plays and skips ahead, favourites it, comes back online, and confirms the server received the progress and favourite (Chromium profiles).
