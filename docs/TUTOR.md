# Subject tutor (spec §8)
- `POST /api/tutor/conversations/{id}/messages` streams SSE: `meta` (sources), `delta` (text), `done` (`answerType`, citations, message id), `error`.
- **Retrieval** is server-filtered: the learner's enrolled subject and level; documents indexed, mapping-confirmed, not rejected and not duplicates. Atlas `$vectorSearch` (`VECTOR_SEARCH=atlas`, index `chunk_vectors`) or local cosine, with a keyword fallback.
- **Source vs general:** answers cite `[S1]` style ids mapped to page ranges. Anything not supported by the passages must start with "General knowledge (not from your curriculum materials):" and is labelled `general`/`mixed` in the UI. Off-subject questions get a refusal (`[[OUTSIDE_SCOPE]]` → `refusal`).
- **Modes:** `hint` (default: guiding questions and hints first, no full solution), `explain`, `check` (feedback on the learner's own answer).
- **Safety:** passages fenced as untrusted data; canary token detects prompt leaks; input screening for injection, self-harm (fixed reply pointing to a trusted adult and 112, no LLM call) and phone numbers; citation ids validated.
- **History & retention:** last 8 messages are sent as context; conversations and messages expire after `TUTOR_RETENTION_DAYS` (TTL); learners can delete conversations and rate answers (thumbs up/down). Limit: `TUTOR_DAILY_MESSAGES_PER_USER` (429 `TUTOR_LIMIT`).
