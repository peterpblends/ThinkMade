# Phase 3 report: Thinking, Seeing, Doing

**Status: complete.** Every script is reviewed before any audio is made.

## Completed

- **Plan outcomes.** The plan stage writes explicit Thinking, Seeing and Doing outcomes, key takeaways, and examples marked real or hypothetical for each episode.
- **Script prompts.** They weave the three outcomes together without announcing them, and give both hosts real roles.
- **Quality gate.** A model grades the spec's eight criteria from 1 to 5. Long scripts are reviewed in windows under a word budget: coverage scores take the best window, quality scores take the worst. Fast deterministic checks run alongside:
  - length within 75–140% of the target
  - Thinking, Seeing or Doing announced as labels
  - a one-sided two-host conversation
  - repeated sentences
  - markdown or stage directions that would be read aloud
- **Revision loop.** Failing sections are rewritten with the reviewer's notes, up to an admin-set number of times (default 2). Scripts that still fail are held for human review and never recorded.
- **Records.** Every review is stored in `episode_quality_check`.
- **App display.** Episodes show their outcomes, examples labelled real or hypothetical, and verified sources, or a plain statement that no book could be verified.

## Live evidence

On the real 7B model the gate rejected scripts for repetition and thin application, rewrote them, and passed the third version.

## Not done

Periodic human review exists as an admin spot-check tool (Phase 9). Nothing schedules reviews automatically.
