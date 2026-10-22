# Phase 8 report: discovery and continued learning

**Status: complete.** Search uses the built-in keyword embedder plus Postgres full-text search. True semantic search needs an embedding model chosen in the admin dashboard (Gemini, Ollama or OpenRouter), which has not been tried here.

## Completed

- **Discover.** Search covers public, finished series only, enforced in SQL. It matches topic, question, mental model, book, author and title. Results rank by full-text score plus vector similarity (pgvector). An empty search shows recently shared series.
- **Reuse.** Before creating, the app suggests strong public matches by the same ranking. One tap creates a personalised version anyway, and nothing extra appears when there is no match.
- **Sharing.** Owners make a series public or private. Share links at `/p/<slug>` are served by the API with Open Graph tags, so previews show the series. Public pages never include the original question, uploads or coaching. Signed-out visitors can listen, and signed-in users can save public series to their library.
- **Continue Learning.** Four ways to build on a series, each creating a new series and preserving the original:
  - **Explore** finds new models.
  - **Go Deeper** focuses on the series' models.
  - **Reinforce** asks for different books.
  - **Get an Update** asks for newer books.

## Limits

- The update option can only verify that newer books exist and when they were published. It cannot fact-check other "new information".
- The built-in embedder captures shared words, not meaning.
