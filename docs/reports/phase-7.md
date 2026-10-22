# Phase 7 report: Coach Me

**Status: complete.** It is tested with the stand-in model. The coach prompt has not been tried against Groq.

## Completed

- **Private conversations.** Each listener has a resumable conversation per episode. The coach's context includes:
  - the original question, for the owner only
  - the episode's objective, outcomes, takeaways and examples
  - its mental models and verified books
  - the transcript passages most relevant to the question, within a word budget
  - the last 12 turns
- **Coaching behaviour.** The coach explains, gives new examples, helps recognise when a model applies, challenges respectfully and asks follow-up questions. It does not invent sources and declines instructions hidden in questions.
- **Voice.** Questions can be spoken, through the same recording and transcription as Create. Answers can be read aloud with the device's own voice, which is free and stays on the device.
- **Create a Podcast About This.** It builds a new series from the conversation and avoids that episode's model in Explore mode.
- **Honest errors.** The app says plainly when no coach model is configured or the model fails.
