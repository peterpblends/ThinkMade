# Phase 5 report: library and player

**Status: complete.** It is tested in headless WebKit (iPhone profile) and Chromium. It has not been tried on a physical phone.

## Completed

- **Player.** One player for the whole app, with a mini player above the tab bar and a full player screen. It has:
  - play/pause, skip 15 seconds either way, seek, and speed from 0.75× to 2×
  - elapsed and remaining time, and next episode
  - favourite, 1–5 star ratings and share
  - mark completed or not started, and Coach Me
  - the mental model shown prominently, with takeaways, sources and the transcript
  - lock-screen and headphone controls through Media Session
- **Progress.** Progress saves every 5 seconds and on pause, seek, ended, episode switch and backgrounding. The server and the client share the same rules:
  - the newest action wins, so a stale device cannot overwrite newer listening
  - deliberate rewinds are kept
  - an episode completes at the admin-set 95%
  - completed episodes stay completed when relistened to
  - a status set by hand is honoured
- **Library.** Continue Listening, My Podcasts, Completed and Favorites, with search, a mental-model filter and sorting. Owners can delete a series, including its audio, and change visibility.

## Tests

Unit tests cover the conflict rules and the save throttle. API tests cover progress, favourites, ratings, the library and privacy. An end-to-end test plays, skips, changes speed, favourites, rates, reloads and resumes, on all three profiles.
