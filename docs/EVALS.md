# MVP Evaluation Plan

## Goals

Evaluate whether the MeetingMind MVP provides useful, grounded, and timely live guidance during scripted sessions.

## Metrics

- Latency: time from customer question to overlay answer card render.
- Grounding: fraction of answer cards that include relevant support snippets.
- Usefulness: manual score from 1 to 5 based on actionability.
- Hallucination rate: percentage of unsupported claims in one-liner or bullets.
- Post-call extraction quality: action-item precision and recall against fixture labels.

## Procedure

1. Load seeded demo knowledge base.
2. Run the scripted mock call session.
3. Capture generated answer cards and post-call report.
4. Compare outputs against expected rubric in `fixtures/evals/expected-baseline.json`.
5. Record pass/fail and notes in an evaluation log.

## Pass Criteria

- Median latency <= 2.5 seconds in browser demo mode.
- At least 80% of answer cards include at least one relevant support snippet.
- Hallucination rate < 5% on the scripted fixture.
- At least 70% of labeled action items are extracted into post-call output.
