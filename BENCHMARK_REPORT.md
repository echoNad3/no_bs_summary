# Varied 15-video benchmark — 2026-07-13

Historical evidence only. TranscriptAPI is now the sole active provider; Supadata remains
implemented but disabled. Current quality results are in `QUALITY_BENCHMARK_REPORT.md`.

This is the human review of the two saved, fully local-cache-disabled runs:

- `results/benchmark-2026-07-13T20-19-07-154Z.json` — Supadata, then TranscriptAPI
- `results/benchmark-2026-07-13T20-20-06-945Z.json` — TranscriptAPI, then Supadata

Both files have `useCache: false`; all 60 transcript records say `source: LIVE`. This
proves the local cache was not used. Provider-side caching cannot be disabled or measured.

## Benchmark set

All 15 videos were public and had captions when checked. Every video has a different
creator.

| Video                                                                       | Creator                       | Duration | Coverage                                       |
| --------------------------------------------------------------------------- | ----------------------------- | -------: | ---------------------------------------------- |
| [But what is a neural network?](https://youtu.be/aircAruvnKk)               | 3Blue1Brown                   |    18:40 | dense visual technology explanation            |
| [The Simplest Math Problem No One Can Solve](https://youtu.be/094y1Z2wpJg)  | Veritasium                    |    22:09 | dense science, sponsor                         |
| [Learn Python — Full Course for Beginners](https://youtu.be/rfscVS0vtbw)    | freeCodeCamp.org              |  4:26:52 | long tutorial, dense/useful                    |
| [The Science of Emotions & Relationships](https://youtu.be/hcuMLQVAgEg)     | Andrew Huberman               |  1:41:02 | long podcast, science, sponsors                |
| [Misterios arqueológicos de Roma](https://youtu.be/tFQ9X4unJYo)             | Raquel de la Morena           |    30:42 | Spanish, commentary, clickbait framing         |
| [Konversationstraining Deutsch B1-C1](https://youtu.be/9OjgE4NXSsw)         | Let's GO! German Online       |    10:17 | German tutorial, product promotion             |
| [The 3 Biggest Weight Loss Lies](https://youtu.be/F04ebV7hNMk)              | Mark Hyman, MD                |    23:57 | fitness/health, product pitch, clickbait       |
| [How to Build Viral Products](https://youtu.be/O8AdZtq91bQ)                 | GenAI Revolution Podcast      |    50:29 | technology podcast, course promotion           |
| [The Egg](https://youtu.be/h6fcK_fRYaI)                                     | Kurzgesagt                    |     8:06 | entertainment/animation                        |
| [Never Gonna Give You Up](https://youtu.be/dQw4w9WgXcQ)                     | Rick Astley                   |     3:33 | music/entertainment                            |
| [FBI Tales & More Untold MKBHD Stories](https://youtu.be/2v5RmVsqU1E)       | WVFRM Podcast                 |  1:34:37 | long entertainment/technology podcast, ads     |
| [Mace Issues GRIM WARNING About The Iran War](https://youtu.be/kq68pEzrJUI) | The Young Turks               |     5:52 | news/commentary, clickbait title               |
| [Peach Cobbler Pound Cake](https://youtu.be/TfJtSyl4uhc)                    | Chewed Up                     |    33:59 | cooking tutorial, entertainment, many sponsors |
| [We Let You Explain White Nationalism](https://youtu.be/HZisCzFLcLE)        | Nico Corazon & The Resistance |     9:41 | political commentary, reaction content         |
| [Yoga For Complete Beginners](https://youtu.be/v7AYKMP6rOE)                 | Yoga With Adriene             |    23:45 | fitness tutorial                               |

## Technical results

Transcript retrieval was reliable in both orders: Supadata 30/30 and TranscriptAPI 30/30.
There were no transcript retries and no 15-second deadline failures.

| Provider      | Combined transcript success |   Median |      p95 |  Slowest |
| ------------- | --------------------------: | -------: | -------: | -------: |
| TranscriptAPI |                       30/30 |    86 ms | 1,890 ms | 3,852 ms |
| Supadata      |                       30/30 | 1,736 ms | 3,220 ms | 3,755 ms |

On the eight videos where both providers returned byte-equivalent normalized transcript
text, the 16 measurements per provider had medians of 82 ms for TranscriptAPI and 1,666 ms
for Supadata. TranscriptAPI is about 20 times faster at the median. Its first-pass p95 was
hurt by several slow auto-caption fetches; those same videos were much faster on pass two,
which may be provider-side warming.

The first pass is the only clean total-time comparison because all 30 Gemini calls
succeeded:

| Provider      | End-to-end success | Median total | p95 total | Slowest total |
| ------------- | -----------------: | -----------: | --------: | ------------: |
| TranscriptAPI |              15/15 |     1,584 ms |  5,474 ms |      5,474 ms |
| Supadata      |              15/15 |     3,323 ms | 13,022 ms |     13,022 ms |

The reversed pass hit Gemini's free-tier 15-request-per-minute quota: TranscriptAPI had
1/15 summaries and Supadata 10/15, for 19 Gemini-stage 429 failures. All 30 transcripts still
succeeded. These were quota failures returned in a few hundred milliseconds, not deadline
failures. The saved runs recorded no retries. The live run exposed that Interactions errors
use `statusCode`, not the mocked `ApiError.status`; that classifier is now fixed and tested,
including respect for a server delay that cannot fit inside the shared 15-second deadline.

### Important comparability limit

No preferred caption language is configured. Supadata selected the first available track
on multilingual videos, including Arabic for four English/Spanish videos and German for the
Rick Astley video. Only 8/15 provider pairs had identical normalized transcript hashes; two
other pairs differed only slightly, while five used clearly different language tracks.
Reliability counts remain valid, but direct content and latency comparisons are strongest
on the eight identical-hash pairs. Do not claim a fully controlled provider comparison until
both providers receive the same explicit per-video language preference.

## Mechanical style review

There is no automated subjective quality score. The following are mechanical counts plus a
manual spot review:

- All 41 successful Gemini outputs were `SKIP`; there were no `WATCH` or `SKIM` verdicts.
- Combined reason and summary length ranged from 22 to 119 words (average 78.5). Three
  representative outputs exceeded 100 words, so the model obeyed the hard limit but often
  missed the intended brutally concise feel.
- All 15 representative reasons use generic "The..." or "This..." openings, and 8/15
  summaries do the same. The writing is clear but frequently sounds like formal AI copy.
- The Python result says the tutorial is "entirely text-based" and lacks visual depth; a
  second neural-network result says visual accompaniment is unnecessary; a second `The Egg`
  result says there is no visual demonstration. Those are unsupported visual claims because
  the benchmark only saw transcripts.
- The yoga output says following the instructor in real time is required, then still chooses
  `SKIP`. That exposes verdict tension rather than a trustworthy quality judgment.
- Reason/summary repetition is mild overall, but the German lesson and yoga entries restate
  the same basic description in both fields.

Why everything became `SKIP`: the rubric explicitly says `SKIP` when the summary captures
essentially everything useful, even if the source has legitimate information. With only a
transcript, Gemini has little evidence for visual or entertainment value and no timestamps
for selecting particular sections, while `WATCH` is explicitly cautious. That combination
makes `SKIP` the easiest defensible label. The model then sometimes violated the visual
knowledge rule to justify it. This verdict distribution is not ready to drive a product.

## Representative output for every video

These are the complete TranscriptAPI outputs from the clean first pass. They are shown for
manual review, not presented as automatically correct.

### But what is a neural network? — SKIP

**Reason:** The transcript provides a clear, conceptual explanation of neural network
architecture that is fully captured in the text.

**Summary:** A neural network is a mathematical function that processes inputs (like pixel
values) through layers of "neurons" to produce an output (like digit recognition). Each
neuron holds a value representing an activation, influenced by weighted connections and
biases from the previous layer. These weights and biases act as knobs that, when correctly
tuned, allow the network to identify patterns like edges, shapes, and eventually digits.
The process uses matrix-vector multiplication and activation functions like sigmoid (or
more modern alternatives like ReLU) to transform inputs into probabilities for each digit.

### The Simplest Math Problem No One Can Solve — SKIP

**Reason:** The video provides a comprehensive overview of the Collatz conjecture, but ends
with a standard, lengthy ad read.

**Summary:** The Collatz conjecture (3x+1) posits that every positive integer will eventually
reduce to the 1-4-2 loop. While verified for all numbers up to 2^68, it remains unproven; it
demonstrates chaotic, random-like behavior and is possibly undecidable.

### Learn Python — Full Course for Beginners — SKIP

**Reason:** This is a basic, long-form tutorial series that is entirely text-based and lacks
the visual depth required to justify watching a video format over reading documentation or
a concise guide.

**Summary:** This video is a comprehensive, multi-part introductory course on Python,
covering everything from basic installation and text editors to variables, data types,
functions, loops, if statements, file I/O, modules, and basic object-oriented programming
concepts (classes and objects). The content is sequential, building from "Hello World" to
creating simple games like a calculator and a madlibs generator.

### The Science of Emotions & Relationships — SKIP

**Reason:** The transcript is heavily padded with lengthy promotional segments and
self-promotion, while the actual scientific discussion is disorganized and lacks actionable
structure.

**Summary:** The episode explores the science of emotions, proposing that emotional states
are built upon three main axes: autonomic arousal (alertness vs. calmness), valence (good vs.
bad), and the balance between interoception and exteroception. Huberman discusses
developmental attachment styles and mentions the role of puberty, kisspeptin, and
pheromonal effects, though he notes that human pheromone effects remain controversial. He
concludes that understanding these three core axes can provide a framework for emotional
regulation, while noting that more complex topics like psychedelics will be covered in
future episodes.

### Misterios arqueológicos de Roma — SKIP

**Reason:** The video provides a loose collection of common archaeological mysteries
without offering any new conclusions or unique evidence.

**Summary:** This video compiles several well-known, unsolved archaeological mysteries:
Roman dodecahedrons, Diquís stone spheres, Japanese shakokidogu figurines, the Phaistos
Disc, Chinese Liangzhu jade artifacts, and the massive Baalbek stones. It reviews existing
academic theories for each—from ritual use to logistical puzzles—but concludes that the
true purposes and construction methods remain unknown.

### Konversationstraining Deutsch B1-C1 — SKIP

**Reason:** The video provides a standard list of German business vocabulary and a basic
dialogue exercise that is fully captured in the transcript.

**Summary:** The video teaches German vocabulary related to the workday (for example,
"sich fertig machen", "Überstunden machen", and "Feierabend machen") and includes a
shadowing exercise with a sample dialogue. It concludes with an interactive practice
section where the host prompts viewers to answer questions about their own professional
life.

### The 3 Biggest Weight Loss Lies — SKIP

**Reason:** The video is a long-winded, promotional advertisement for the speaker's
lab-testing business disguised as general weight loss advice.

**Summary:** Dr. Mark Hyman argues that weight management is driven by diet quality,
hormones (insulin/cortisol), and gut health rather than just calories. He recommends
prioritizing whole, unprocessed foods, high protein intake (1 gram per pound of goal
weight), fiber, and healthy fats while avoiding industrial seed oils and sugar. He suggests
tracking food intake temporarily to build awareness and emphasizes that many chronic
health issues result from poor metabolic health, which he suggests monitoring via specific
lab biomarkers.

### How to Build Viral Products — SKIP

**Reason:** The transcript is a repetitive, loosely structured conversation dominated by
generalities and personal anecdotes about the guest's career rather than actionable, dense
information.

**Summary:** Reface co-founder Ivan CB explains that their success came from launching a
high-quality, viral deepfake app during the COVID-19 pandemic. He highlights that while
"Number 1 in the App Store" provides valuable social proof and media attention, it is not a
sustainable business metric. The company has since shifted from a single-app model to an AI
studio approach, currently focusing on a portfolio of utility apps like a calorie tracker
and tattoo visualizer. His primary advice for AI adoption is to focus on fundamentals and
consistently "get your hands dirty" with new tools to stay competitive.

### The Egg — SKIP

**Reason:** This is a verbatim transcript of the short story "The Egg" by Andy Weir, which
is widely available in text format.

**Summary:** Upon dying, a person meets God and learns that they are the only soul in
existence, reincarnating into every human who has ever lived across time to mature into a
deity.

### Never Gonna Give You Up — SKIP

**Reason:** This is a music video, not an informational resource.

**Summary:** The transcript is the lyrics to Rick Astley's "Never Gonna Give You Up."

### FBI Tales & More Untold MKBHD Stories — SKIP

**Reason:** The transcript is a collection of informal, rambling anecdotes about the host's
past experiences that provide no actionable or educational value.

**Summary:** This bonus episode of the Waveform podcast features the hosts sharing various
"untold" stories, including the origin of the "Autofocus" channel name, an investigation
into a fan with an "MKBHD" license plate, an awkward interaction with Nico Rosberg at CES,
and an FBI interview regarding a scam involving Escobar-branded phones. The discussion also
covers their experiences with a Dyson marketing campaign, a disastrous EV road trip with a
Ford Mach-E, and several behind-the-scenes production anecdotes.

### Mace Issues GRIM WARNING About The Iran War — SKIP

**Reason:** The video consists of rambling political punditry and opinions rather than
substantive information or objective analysis.

**Summary:** The segment discusses Representative Nancy Mace's opposition to a potential
ground war in Iran and highlights public polling data showing broad disapproval of further
military involvement. The hosts use these points to debate internal Republican divisions
regarding foreign interventionism and the historical risks of engaging in regional
conflicts.

### Peach Cobbler Pound Cake — SKIP

**Reason:** The content is dominated by informal banter, irrelevant personal anecdotes,
and repetitive interruptions rather than a concise cooking tutorial.

**Summary:** To make this peach pound cake, roast peaches with brown sugar, cornstarch,
cinnamon, almond extract, peach preserves, and lemon juice at 400°F for 20-25 minutes.
Prepare a cake batter using butter, sugar, eggs, flour (substitute a portion with cornstarch
for cake flour), sour cream, and spices. Layer half the batter, half the peaches, the
remaining batter, and a crumble topping (flour, brown sugar, nutmeg, cinnamon, butter) in a
pan. Bake slowly at 300°F.

### We Let You Explain White Nationalism — SKIP

**Reason:** The video is essentially a compilation of reading YouTube comments aloud with
commentary, offering no new information beyond the host's reaction to viewer sentiments.

**Summary:** The creator discusses the harassment and departure of a history content
creator targeted by white nationalists. The video consists of reading and validating viewer
comments that describe white nationalism as a fragile, identity-based reaction to economic
and social insecurity, while emphasizing the importance of historical literacy and nuance.

### Yoga For Complete Beginners — SKIP

**Reason:** This is a basic 20-minute guided yoga class for beginners that requires
following along in real time, making a text summary redundant.

**Summary:** The video provides a guided, beginner-level yoga sequence focusing on
foundational poses, alignment, breathing, and body awareness. It includes seated poses,
cat-cow, downward dog, forward folds, and basic standing warriors. The instructor emphasizes
connecting movement with breath and encourages a "beginner's mind" rather than achieving
perfect form.

## Decision

TranscriptAPI remains the recommended default because transcript reliability tied at 100%
while its controlled median was about 20 times faster. Supadata is the fallback: it was
also 100% reliable and had a similar worst-case transcript time, but it is much slower at
the median and its implicit language choice is less predictable.

The technical pipeline is not ready for product development. Before product work, add an
explicit per-video caption-language preference used by both providers, add quota-aware
Gemini request pacing outside each measured 15-second run, rerun both provider orders, and
manually review whether the prompt can produce a credible WATCH/SKIM/SKIP mix without visual
claims.
