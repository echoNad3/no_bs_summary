# Final cached prompt comparison

Current baseline: seven prompt-v10 outputs from
`results/benchmark-2026-07-13T21-28-46-347Z.json` plus the prompt-v11 Python
correction from `results/benchmark-2026-07-13T21-30-27-196Z.json`.

Final voice set: six prompt-v20 outputs from
`results/benchmark-2026-07-14T15-22-33-557Z.json` plus the two prompt-v22
tutorial outputs from `results/benchmark-2026-07-14T15-25-24-940Z.json`.
Prompt v22 keeps the v20 system prompt and adds the technical-`input` false-positive fix
and a clearer structured-course constraint.

All retained runs are `cacheOnly: true`, use `source: CACHED`, have no `transcriptMs`,
and report zero live transcript attempts and retries. No TranscriptAPI request was made.
The final entries below are exact. Longer baseline entries are lightly condensed; their
source JSON files preserve the exact text.

## 1. But what is a neural network?

Current - **WATCH**

- Reason: The explanation builds a conceptual model of neural networks layer-by-layer,
  making the step-by-step breakdown of weights, biases, and matrix multiplication essential
  for understanding the underlying math.
- Summary: Neural networks process data through layers of neurons, where each neuron acts as
  a function holding a value between 0 and 1. Input layers receive pixel data, which
  propagates through hidden layers via weighted sums and biases, then passes through a
  sigmoid or ReLU activation function to determine the output. The network learns by
  adjusting 13,000+ internal parameters to recognize patterns that eventually form digits.

Final - **WATCH**

- Reason: The value here is in the slow, clear breakdown of how the math connects to the
  step-by-step structure; watching it makes the abstract matrix operations feel intuitive
  instead of just symbols on a page.
- Summary: A neural network is a giant math function where pixel values pass through layers
  of neurons, each applying weighted sums, biases, and a squishing function to recognize
  patterns like edges, loops, and eventually full digits.

## 2. Learn Python - Full Course for Beginners

Current - **WATCH**

- Reason: A structured, step-by-step programming course where each lesson builds on the
  previous one, making it necessary to watch the guided examples to learn.
- Summary: Python basics including setup, variables, data types, math, user input, lists,
  tuples, functions, return statements, if statements, comparison operators, loops, working
  with files, modules, and classes.

Final - **WATCH**

- Reason: A full-length, structured syllabus that introduces essential programming tools
  and patterns through guided, incremental lessons.
- Summary: Python basics including variables, data types, user input, lists, loops,
  functions, file handling, and classes, concluding with a project-based approach.

## 3. The Science of Emotions & Relationships

Current - **SKIM**

- Reason: The useful content regarding the core axes of emotion is buried amidst extensive
  advertising, promotional announcements, and long-winded anecdotes.
- Summary: Emotions are defined by three interacting axes: autonomic arousal, valence, and
  internal versus external focus. Social bonding depends on gaze, vocalization, affect, and
  touch.

Final - **SKIP**

- Reason: A long-winded podcast episode filled with extensive personal anecdotes, lengthy
  sponsor segments, and repetitive tangents that could be cut down to a few paragraphs.
- Summary: Emotions are best understood through three axes: your level of alertness, whether
  you feel good or bad (valence), and your focus (internal versus external). Healthy
  emotional development relies on bonds built through gaze, vocalization, affect, and touch,
  which help infants and adolescents predict their environment and regulate their internal
  states.

## 4. Se han hallado por toda la antigua Roma y son un misterio

Current - **SKIP**

- Reason: A compilation of well-known archaeological mysteries, and the summary explains
  that there is no consensus or factual conclusion for any of them.
- Summary: Roman dodecahedrons, Diquís stone spheres, Jomon shakokidogu figurines, the
  Phaistos Disc, Liangzhu jade artifacts, and the Baalbek monoliths remain unsolved. Experts
  have theories, but no definitive evidence supports one answer.

Final - **SKIP**

- Reason: It's just a long list of historical mysteries with no new answers, padding out
  the time with speculation instead of facts.
- Summary: Archaeologists still haven't determined the purpose of Roman dodecahedrons,
  Costa Rican stone spheres, Japanese shakokidogu figurines, the Phaistos Disc, Chinese jade
  bi discs, or the massive Baalbek stones.

## 5. Sprich mit uns! Konversationstraining Deutsch B1-C1

Current - **WATCH**

- Reason: Includes a guided shadowing exercise and a practice session where the viewer is
  prompted to answer questions aloud, which gives more value than just reading the terms.
- Summary: Learn German workday vocabulary, repeat a dialogue at different speeds, and
  answer personal questions aloud.

Final - **WATCH**

- Reason: You need to speak along with the guided shadowing exercises to actually practice
  your timing and pronunciation.
- Summary: Learn key vocabulary for describing your workday—like commuting, deadlines, and
  overtime—then use it to hold a conversation through repeated listening and speaking drills.

## 6. The 3 Biggest Weight Loss Lies Your Doctor Still Believes

Current - **SKIP**

- Reason: The useful advice regarding diet and protein intake is diluted by a lengthy sales
  pitch for a blood testing service and repetitive, common-sense nutrition platitudes.
- Summary: Eat whole foods, prioritize protein and fiber, avoid ultra-processed ingredients,
  and track intake temporarily if you need a portion reality check.

Final - **SKIP**

- Reason: It's standard clean-eating advice padded with a sales pitch for a blood-testing
  startup.
- Summary: Prioritize whole foods over ultra-processed products, eat a palm-sized portion of
  protein at every meal, consume plenty of fiber and healthy fats, and consider temporary
  calorie tracking to reset your habits.

## 7. The Egg - A Short Story

Current - **WATCH**

- Reason: The story is a dialogue-driven narrative performance that relies on its pacing
  and conversational tone to convey its philosophical message.
- Summary: Every person is the same soul living every human life, growing into a god after
  experiencing everyone else's joy and suffering.

Final - **WATCH**

- Reason: The entire point of the story is the emotional delivery and how the dialogue
  unfolds between the two characters.
- Summary: Upon dying, a soul learns they are reincarnated into every human who has ever
  lived to gain experience and eventually become a god.

## 8. Yoga For Complete Beginners

Current - **WATCH**

- Reason: A guided follow-along yoga session where the instructor gives real-time pacing,
  alignment cues, and breathing reminders that are essential to perform the movements safely.
- Summary: Move from seated breathing and gentle stretches through cat-cow, downward dog,
  mountain pose, and Warriors I and II while keeping the spine long and lower body engaged.

Final - **WATCH**

- Reason: You need to follow the instructor's spoken cues and pacing to safely learn the
  poses and breathing patterns.
- Summary: This sequence walks you through beginner-friendly poses like Sukhasana, cat-cow,
  downward dog, and Warrior I and II, focusing on body alignment and controlled breathing.

## Review

- Verdicts: 5 WATCH and 3 SKIP. No distribution was forced.
- Clear improvement: shorter outputs, less Wikipedia-style wording, stronger ad/padding
  callouts, English output for Spanish and German captions, and no unsupported visual claim.
- No reason repeats the same point as its summary.
- Remaining concern: the neural-network and Python reasons are still more formal than the
  strongest examples. This is model variability at default temperature 1.0, not a reason to
  add more video-specific prompt rules.
