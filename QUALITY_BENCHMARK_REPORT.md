# MVP summary-quality acceptance - 2026-07-14

Prompt version: `verdict-v27-2026-07-14`.

Accepted result provenance:

- Seven outputs from the full varied cache-only run:
  `results/benchmark-2026-07-14T18-19-38-683Z.json`.
- The yoga output from the targeted cache-only retry:
  `results/benchmark-2026-07-14T18-20-47-678Z.json`.

Both result files say `cacheOnly: true`. Every run used `source: CACHED`, no run has a
`transcriptMs`, and all transcript retry counts are zero. The report for each run says zero
live transcript attempts. No TranscriptAPI request was made during this work.

The full run correctly rejected the first yoga response because its reason claimed knowledge
of unseen visuals. A targeted run against the same cached transcript and prompt produced a
valid replacement after a general cleanup regression was fixed. The eight-video manifest was
then restored.

## Verdict distribution

- WATCH: 6/8 (75%)
- SKIM: 2/8 (25%)
- SKIP: 0/8 (0%)

No distribution was requested from Gemini or forced in code. Every accepted summary has 4-5
sentences. Every reason is one sentence, and every reason-plus-summary pair is below the
150-word hard limit.

## Final accepted outputs

### 1. But what is a neural network?

Verdict: **WATCH**

Reason: It breaks down a complex technical topic into simple, manageable pieces without
using confusing jargon.

Summary: A neural network is essentially a giant mathematical function designed to recognize
patterns, like handwritten digits. The structure uses layers of neurons that hold values
between 0 and 1, with each layer processing information from the previous one. Connections
between these neurons are governed by weights and biases, which act as knobs that the
computer adjusts during the learning process. These parameters allow the network to identify
features like edges and shapes to classify inputs. The entire system is expressed through
linear algebra, specifically using matrix multiplication to efficiently calculate activations
across layers.

### 2. Learn Python - Full Course for Beginners

Verdict: **WATCH**

Reason: It explains core programming ideas with clear examples and a steady pace that makes
a complex subject approachable for beginners.

Summary: It covers the basics of Python programming, starting with installation and setting
up an integrated coding setup. It introduces basic topics including variables, data types,
arithmetic operations, and user input. The lessons also cover control flow with if
statements, loops for repeating tasks, and functions for organizing code. Finally, it
explores data structures like lists, tuples, and dictionaries, along with file handling,
modules, and an introduction to object-oriented programming with classes.

### 3. The Science of Emotions & Relationships

Verdict: **SKIM**

Reason: The core ideas about emotional regulation are useful, but the episode is heavily
padded with repetitive sponsor plugs and tangential anecdotes.

Summary: Emotions are not discrete circuits but arise from a dynamic balance of three axes:
autonomic arousal, valence (good/bad), and attentional focus (internal vs. external). Humans
naturally shift between interoception, which is focusing on internal bodily states, and
exteroception, which is monitoring the outside environment. This ability to balance these
states develops in infancy through bonds defined by gaze, vocalization, touch, and affect.
Adolescence serves as a critical period of physical and neural maturation where individuals
begin self-sampling environments to test autonomy and social reliability. You can improve
emotional awareness by learning to identify your position on these axes rather than just
labeling moods.

### 4. Se han hallado por toda la antigua Roma y son un misterio

Verdict: **WATCH**

Reason: It presents several legitimate historical mysteries clearly and avoids the typical
clickbait traps usually associated with these topics.

Summary: It explores several archaeological objects that lack a confirmed purpose, including
the Roman dodecahedron, Costa Rica's Diquis stone spheres, and Japan's shakokidogu figurines.
It also examines the Phaistos Disc, a clay artifact featuring mysterious printed symbols,
and the Neolithic jade bi and cong discs from China. Finally, it discusses the massive stone
monoliths of Baalbek in Lebanon and the technical questions surrounding their intended
transport. Each section highlights the main theories proposed by experts while acknowledging
that no definitive conclusions have been reached.

### 5. Sprich mit uns! Konversationstraining Deutsch B1-C1

Verdict: **WATCH**

Reason: It's a practical way for German learners to practice speaking and build vocabulary
through active, guided repetition.

Summary: It introduces essential German vocabulary and phrases for describing a typical
workday, such as commuting, working from home, and handling deadlines. It gives specific
questions and answers to help viewers discuss their jobs and daily schedules. The lesson
includes a shadowing exercise, where viewers practice speaking at different speeds alongside
a native speaker. Finally, the instructors offer interactive prompts for viewers to practice
their responses out loud.

### 6. The 3 Biggest Weight Loss Lies Your Doctor Still Believes

Verdict: **SKIM**

Reason: The core advice on prioritizing whole foods and high-quality protein is valuable, but
the video is padded with repetitive pitches for the host's health testing company.

Summary: Weight management is presented as a complex issue influenced by hormonal health,
gut bacteria, and food quality rather than just calorie counting. The speaker emphasizes
shifting away from ultra-processed foods toward a diet rich in non-starchy vegetables,
fiber, and high-quality proteins like wild-caught fish or grass-fed meats. Tracking food
intake through apps or measuring portions by hand is suggested as a temporary tool to build
awareness of eating patterns. Hormonal balance, specifically about insulin, is highlighted
as a primary driver of fat storage and metabolic health. Additionally, the speaker notes
that environmental toxins and sleep quality play significant roles in weight regulation
that go beyond typical dietary advice.

### 7. The Egg - A Short Story

Verdict: **WATCH**

Reason: It's an unusual perspective on human connection and the nature of life that hits
hard without dragging.

Summary: A person dies in a car accident and encounters God in a void. God explains that the
soul is meant to grow through thousands of reincarnations across different points in
history. Every human being who has ever lived is revealed to be a different version of the
same soul. The entire universe acts as an egg, designed for this soul to mature until it is
ready to be born as a god.

### 8. Yoga For Complete Beginners

Verdict: **WATCH**

Reason: It guides absolute beginners through basic poses with a focus on form and breathing
without being overly complicated.

Summary: This sequence focuses on basic movements including seated stretches, tabletop
cat-cow, and standing poses like Warrior I and II. The instructor emphasizes proper
alignment, such as keeping the spine long and maintaining an active core, rather than
achieving a perfect look. It highlights the importance of connecting physical movement with
breath and listening to your body to avoid strain. You will practice transitioning between
positions while building strength and stability through your foundation. It serves as a
gentle introduction to yoga that prioritizes body awareness over intensity.

## Manual review

- Verdict bias: the two SKIM verdicts identify real useful material plus documented padding;
  none of the normal worthwhile or entertaining videos were rejected merely because their
  content could be summarized.
- Excessive brevity: no accepted summary is only 1-2 sentences; all are 4-5 sentences and
  retain multiple useful points.
- Repetition: reason and summary stay separate. The reason judges the viewing value or main
  problem, while the summary describes the content.
- Formal wording: the accepted voice is much more natural, though technical source material
  can still produce terms such as `interoception`, `valence`, and `linear algebra` when they
  are needed to explain the actual content.
- Unsupported claims: no accepted output invents a runtime or claims to have seen visuals.
  Health and science claims are attributed to the speaker or framed as the video's position.

This is a manual quality review, not an automated quality score. Gemini runs at its existing
temperature, so exact wording and whether a response passes the strict validators can vary.
