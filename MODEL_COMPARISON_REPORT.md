# Cached-only Gemini model comparison

Run date: 2026-07-14  
Prompt: `summary-first-v28-2026-07-14`  
Transcript access: cache only; zero TranscriptAPI requests

## Outcome

Keep `gemini-3.1-flash-lite` as the production default for now. It returned eight detailed
summaries and a 6 WATCH / 2 SKIM / 0 SKIP distribution. `gemini-2.5-flash` returned Google's
same 404 on every call through both Interactions and `generateContent`: “no longer available
to new users.” It produced no output or usage tokens, so a quality difference, inference-speed
difference, and measured 2.5 cost projection cannot be calculated honestly.

Google's current deprecation page still lists 2.5 Flash with an earliest shutdown date of
2026-10-16 and recommends 3.5 Flash as its replacement. That public schedule does not override
the observed API-account restriction.

## Protocol and provenance

- Same eight cached transcripts, video order, titles, languages, and transcript SHA-256 hashes.
- Same production prompt, input template, structured JSON schema, cleanup, and validation.
- Comparison-only `generateContent` transport for both requested models. Production remains on
  Interactions and its default model was not changed.
- 3.1 Flash-Lite: `thinkingLevel=MINIMAL`.
- 2.5 Flash: `thinkingBudget=0`, the lowest setting documented for 2.5 Flash on
  `generateContent`.
- No AI judge. The review below is a direct human inspection plus transcript spot checks.

Evidence files:

- `results/benchmark-2026-07-14T19-38-06-565Z.json` — final 3.1 Flash-Lite run, 8/8 accepted.
- `results/benchmark-2026-07-14T19-35-11-735Z.json` — 2.5 Flash run, 8/8 endpoint failures.

## Cost and speed

Standard paid rates used from Google's pricing page:

- Gemini 3.1 Flash-Lite: $0.25 / 1M text input tokens; $1.50 / 1M output tokens, including
  thinking.
- Gemini 2.5 Flash: $0.30 / 1M text input tokens; $2.50 / 1M output tokens, including thinking.

Cost formula: `input tokens × input rate + (output tokens + thought tokens) × output rate`.

| Metric                          | Gemini 3.1 Flash-Lite |                             Gemini 2.5 Flash |
| ------------------------------- | --------------------: | -------------------------------------------: |
| Successful model outputs        |                 8 / 8 |                                        0 / 8 |
| Average input tokens            |             14,072.25 |                                 Not measured |
| Average output tokens           |               479.375 |                                 Not measured |
| Average thought tokens          |                     0 |                                 Not measured |
| Mean inference time             |            2,631.5 ms |           Not measurable; calls returned 404 |
| Median inference time           |              2,690 ms |           Not measurable; calls returned 404 |
| Estimated cost of completed run |             $0.033897 | $0.00 token usage reported; no completed run |
| Projected cost / 1,000          |           **$4.2371** |                               Not measurable |
| Exceeds $3 / 1,000              |               **Yes** |    Unknown; price-only proxy also exceeds $3 |

Applying 2.5 Flash prices to 3.1 Flash-Lite's measured token volume yields **$5.4201 per
1,000 videos**. This is only a price-rate proxy; 2.5 tokenization and output length were not
measured.

| Video                 | Verdict |     Time |  Input | Output | Estimated cost |
| --------------------- | ------- | -------: | -----: | -----: | -------------: |
| Neural network        | WATCH   | 2,304 ms |  4,737 |    429 |    $0.00182775 |
| Python course         | WATCH   | 3,234 ms | 62,680 |    564 |    $0.01651600 |
| Emotions              | SKIM    | 2,684 ms | 22,174 |    471 |    $0.00625000 |
| Archaeology mysteries | WATCH   | 3,277 ms |  6,297 |    619 |    $0.00250275 |
| German conversation   | WATCH   | 1,908 ms |  2,536 |    377 |    $0.00119950 |
| Weight loss           | SKIM    | 3,125 ms |  6,289 |    573 |    $0.00243175 |
| The Egg               | WATCH   | 1,824 ms |  2,078 |    312 |    $0.00098750 |
| Beginner yoga         | WATCH   | 2,696 ms |  5,787 |    490 |    $0.00218175 |

## Human quality review

Gemini 3.1 Flash-Lite did the main job well. It retained high-value specifics such as
784 input neurons, roughly 13,000 parameters, named Python methods, attachment categories,
leptin and kisspeptin, archaeological dates and weights, German phrases, protein percentages,
and named yoga poses. The archaeology, Python, German, health, and science outputs are clearly
split into useful topic bullets. Vague summary wording was largely avoided, and output length
scaled up for the dense Python transcript.

Spot checks against all eight cached transcripts found the important names, numbers, terms,
and events used by the summaries. No obvious invented claim appeared in those checks. Health
and disputed archaeology claims were generally attributed, although attribution could still
be more consistent inside some nutrition bullets.

The remaining weakness is voice, not summary content. Several reasons are still polished or
adjective-heavy instead of blunt: “remarkably clear and intuitive,” “high-quality, dense, and
beginner-friendly,” and “fascinating, well-researched.” The model also used bullets for every
video, including the single-story _The Egg_, despite the prompt preferring compact paragraphs
for one coherent topic. These are meaningful general quality concerns, but there is no 2.5
output against which to measure improvement.

## Side-by-side result status

| Video                 | Gemini 3.1 Flash-Lite | Gemini 2.5 Flash                         |
| --------------------- | --------------------- | ---------------------------------------- |
| Neural network        | Output below; WATCH   | No output — 404 unavailable to new users |
| Python course         | Output below; WATCH   | No output — 404 unavailable to new users |
| Emotions              | Output below; SKIM    | No output — 404 unavailable to new users |
| Archaeology mysteries | Output below; WATCH   | No output — 404 unavailable to new users |
| German conversation   | Output below; WATCH   | No output — 404 unavailable to new users |
| Weight loss           | Output below; SKIM    | No output — 404 unavailable to new users |
| The Egg               | Output below; WATCH   | No output — 404 unavailable to new users |
| Beginner yoga         | Output below; WATCH   | No output — 404 unavailable to new users |

Every 2.5 cell represents the actual result for that video: no model output was returned. The
full 3.1 outputs follow without rewriting.

## Final outputs

### But what is a neural network?

**WATCH** — It gives a remarkably clear and intuitive explanation of how neural networks are
structured as mathematical systems without getting bogged down in jargon.

- **Neural Network Structure:** A neural network is defined as a series of connected neurons,
  where each neuron holds a number between 0 and 1 representing its activation level. In the
  context of digit recognition, the input layer consists of 784 neurons corresponding to the
  28x28 pixel grid of an image. The final output layer has 10 neurons, each representing a digit
  from 0 to 9, where the highest activation indicates the network's prediction. The “hidden”
  layers between the input and output are responsible for identifying increasingly complex
  patterns, such as edges, loops, or lines.
- **Mechanism of Influence:** The behavior of the network is governed by weights and biases.
  Every connection between neurons has a weight, which determines the importance of a specific
  input, and each neuron has a bias, which determines the threshold of the weighted sum required
  to make that neuron active. These values are combined through a weighted sum and passed
  through an activation function, such as the sigmoid function, to squash the result into a
  range between 0 and 1. This entire process is represented mathematically as a series of matrix
  vector products.
- **Learning and Parameters:** A simple network with two hidden layers of 16 neurons each
  contains roughly 13,000 individual weights and biases. Learning is the process of finding the
  optimal values for these 13,000 parameters to accurately perform the task. While
  human-engineered weights are theoretically possible, the strength of the system lies in
  training it to determine these values automatically from data.
- **Modern Considerations:** While the sigmoid function was traditionally used to mirror
  biological neuron activity, modern research often favors the Rectified Linear Unit (ReLU)
  function. ReLU functions—defined as the maximum of zero and the weighted sum—are generally
  easier to train and support deeper network architectures.

### Learn Python - Full Course for Beginners

**WATCH** — It's a high-quality, dense, and beginner-friendly resource that serves as an
excellent basic introduction to Python programming.

- **Environment Setup:** The instructor explains how to download Python 3 from python.org and
  set up PyCharm as an integrated coding setup (IDE) for managing code, including configuring
  project settings and interpreters.
- **Programming Basics:** The course covers essential syntax, including print statements for
  outputting data to the console, and emphasizes that Python is beginner-friendly due to its
  simple, readable syntax.
- **Data Management:** Detailed explanations are provided for using variables as containers for
  data, the three core data types (strings, numbers, and Booleans), and how to use arithmetic
  operators and mathematical functions like `abs`, `pow`, `max`, `min`, `round`, `floor`, and
  `sqrt` (via the math module).
- **Strings:** The tutorial covers string concatenation, escape characters (`\n`, `\"`), and
  methods such as `.lower()`, `.upper()`, `.islower()`, `.isupper()`, `len()`, indexing,
  `.index()`, and `.replace()`.
- **Input and Logic:** Users are taught how to capture user input using `input()`, perform type
  conversion (`int`, `float`), and use `if` statements with comparison operators and logical
  operators (`and`, `or`, `not`) to control program flow.
- **Data Structures:** The course explains how to organize data using lists (including list
  functions like `.extend()`, `.append()`, `.insert()`, `.remove()`, `.clear()`, `.pop()`,
  `.index()`, `.count()`, `.sort()`, `.reverse()`, and `.copy()`) and tuples, noting that tuples
  are immutable.
- **Control Flow:** Broad guides are provided for `while` loops, `for` loops (including
  iterating over strings, arrays, and ranges), and nested loops for parsing two-dimensional
  lists.
- **Functions and Modules:** The instructor details how to define functions using `def`, pass
  parameters, and return values. It also covers importing external modules and the use of `pip`
  for installing third-party packages.
- **Error Handling and File Operations:** The course covers robust error handling with
  `try-except` blocks and techniques for reading, writing, and appending data to external text
  files.
- **Object-Oriented Programming:** The course concludes with an introduction to classes and
  objects, explaining `__init__` methods, class functions, and the concept of inheritance for
  creating specialized classes.

### The Science of Emotions & Relationships

**SKIM** — It contains a significant amount of repetitive sponsorship, promotional content,
and general framing, though the scientific insights on emotional regulation are valuable.

- **The Core Framework of Emotions:** Emotions are complex but tractable. Instead of searching
  for a singular “emotion center” in the brain, understand emotions through three dynamic axes:
  autonomic arousal (alertness vs. calmness), valence (feeling good vs. bad), and the balance
  between interoception (focus on internal bodily states) and exteroception (focus on external
  events). This framework helps explain why emotions are contextual and how individuals can
  consciously shift their attentional focus to better regulate their states.
- **Emotional Development:** Emotional patterns are heavily influenced by early life
  experiences, as evidenced by Bowlby and Ainsworth's “strange situation” experiments, which
  categorized attachment styles (secure, avoidant, ambivalent, and disorganized). These styles
  relate to how individuals use gaze, vocalization, affect, and touch to form bonds and predict
  their environment. Infants initially rely on interoception to signal needs, and caregivers
  help them learn to manage anxiety by bridging their internal state with external reality.
- **Puberty and Maturation:** Puberty is a biological transition triggered by hormones like
  leptin (linked to body fat) and kisspeptin. It marks a shift from being a generalist to a
  specialist, characterized by increased neural connectivity between the prefrontal cortex,
  amygdala, and dopamine centers. During this phase, adolescents naturally seek “dispersal”
  from primary caregivers to test autonomy and social contingencies. This period is a critical
  time for testing behavior and learning to navigate risk.
- **Neurobiology of Bonds:** Oxytocin is a key molecule for pair bonding, increasing social
  synchrony and awareness of others' emotional states. While intranasal oxytocin is sometimes
  studied for increasing positive communication or monogamous behavior, its effects remain
  nuanced. Vasopressin is similarly linked to pair bonding and memory, with research on prairie
  voles suggesting it influences monogamous tendencies. The vagus nerve is also discussed as
  an activation system for alertness and arousal rather than a simple “calm” switch, which is
  vital for understanding emotional shifts during severe depression or stress.

### Se han hallado por toda la antigua Roma y son un misterio

**WATCH** — It gives a fascinating, well-researched overview of several historical artifacts
that remain unexplained by modern archaeology.

- **Roman Dodecahedrons:** Over 130 of these bronze, 12-sided objects have been found across
  Roman Europe, primarily in Gaul and Britain, dating from the 2nd to 4th centuries AD. They
  feature varying circular holes on each face and small knobs on their vertices. Despite over
  50 theories—ranging from measuring instruments, dice, and candle holders to magical ritual
  tools—no concrete archaeological or textual evidence exists to explain their function.
- **Diquís Stone Spheres (Costa Rica):** Discovered during 1930s deforestation, these over 500
  spheres range from a few centimeters to 2.5 meters in diameter and weigh up to 16 tons. Made
  primarily of granodiorite or gabbro, their exact purpose remains a mystery. Theories include
  them serving as social status markers, astronomical calendars for agricultural cycles, or
  symbols of indigenous cosmovision.
- **Shakokidogu (Japan):** These Jomon-period (14,500–300 BC) clay figurines are famous for their
  oversized, “snow-goggle” eyes. While some speculate they represent extraterrestrial visitors,
  scholars propose they were tools for sympathetic magic, where a person might transfer an
  illness to a figurine and then break it, or were associated with fertility and shamanic
  rituals.
- **Phaistos Disc (Crete):** Found in the Minoan palace of Phaistos, this clay disc features
  spiral inscriptions created by pressing pre-made stamps into the clay, leading some to call
  it the world's oldest printed document. It remains undeciphered and controversial; while some
  scholars believe it contains an ancient language, others, such as linguist Jerome Eisenberg,
  have argued it may be a 20th-century forgery created by its discoverer, Luigi Pernier.
- **Liangzhu Jade Bi and Cong (China):** Found in elite Neolithic tombs, these jade discs (bi)
  and tubes (cong) appear to have held ritual significance. Thousands have been recovered,
  often placed around the deceased. Hypotheses suggest they represented the heavens and earth,
  or were used to guide the soul, though their exact cultural function remains speculative.
- **Baalbek Stones (Lebanon):** During the Hellenistic period, builders quarried massive stone
  blocks for the Temple of Jupiter. Three of these, known as the Trilithon, remain at the quarry
  site today. The smallest weighs 1,000 tons, while the largest weighs 1,650 tons. The central
  mystery is how ancient engineers intended to move and elevate these blocks, as they far exceed
  the lifting capacity of any known technology from that era.

### Sprich mit uns! Konversationstraining Deutsch B1-C1

**WATCH** — It's a practical and clear German lesson that gives useful vocabulary, phrases,
and interactive speaking practice for intermediate to advanced learners.

- **Vocabulary for the workday:** The presenters introduce key reflexive verbs and terms
  including _sich fertig machen_ (to get ready), _zur Arbeit pendeln_ (to commute), _im
  Homeoffice arbeiten_ (to work from home), and _mit der Arbeit beginnen_ (to start work).
  Further terminology for daily tasks includes _E-Mails beantworten_ (to answer emails), _einen
  Bericht/Protokoll schreiben_ (to write a report/minutes), _Verantwortung übernehmen_ (to take
  responsibility), _eine Deadline haben_ (to have a deadline), _ein Problem lösen_ (to solve a
  problem), _Überstunden machen_ (to work overtime), _Feierabend machen_ (to finish work for the
  day), and _sich entspannen_ (to relax).
- **Conversation structure:** The lesson covers standard questions and responses for discussing
  one's professional life, such as asking about a typical day, working hours, and how one spends
  time after work. It highlights the distinction between _Ich beginne mit der Arbeit_ (I start
  working) and _Die Arbeit beginnt_ (the work begins).
- **Shadowing practice:** The video includes a structured dialogue exercise performed three
  times: first at a slow pace for comprehension, then at natural speed, and finally with the
  viewer speaking Theresa's lines to practice timing and pronunciation.
- **Interactive training:** The lesson concludes with a guided Q&A section where the viewer is
  prompted to answer questions about their own workday in real-time, encouraging spontaneous
  speech.

### The 3 Biggest Weight Loss Lies Your Doctor Still Believes

**SKIM** — The core advice is solid, but the delivery is heavily padded with repetitive
personal marketing and generic wellness industry tropes.

- **The Failure of Calorie Counting:** Dr. Mark Hyman argues that obesity rates are climbing
  globally despite reduced calorie and sugar consumption because the “calories in, calories
  out” model ignores food quality and hormonal impact. He claims that sugar and starch spike
  cortisol—a fat-storing hormone—which induces muscle loss, insulin resistance, and visceral
  fat accumulation.
- **Defining Healthy Weight:** Weight should be measured by body composition and visceral fat
  rather than just BMI. Dr. Hyman recommends professional tools like DEXA scans or body
  composition scanners. He also suggests tracking blood biomarkers, specifically fasting
  insulin, leptin, adiponectin, and C-reactive protein, to assess metabolic health.
- **Ultra-Processed Foods:** The speaker asserts that 60% of American calories come from
  ultra-processed foods. He uses the “Nova classification” to define these as items containing
  ingredients not found in a standard home kitchen (such as maltodextrin or guar gum). He warns
  that health claims on packaging (e.g., “gluten-free” cookies) are marketing tactics to obscure
  poor nutritional quality.
- **Protein Intake:** Dr. Hyman suggests consuming 25–30% of daily calories as protein, or
  roughly one gram per pound of ideal body weight. He advises prioritizing animal protein for
  its superior bioavailability and suggests a palm-sized portion of protein at every meal. He
  warns against plant-based “fake meats” (like Impossible or Beyond brands) as they are highly
  processed.
- **Fiber and Gut Health:** High fiber intake is essential to activate satiety hormones like
  GLP-1 and PYY. He promotes non-starchy vegetables as the primary volume of a plate, ideally
  covering 75% of the meal. He argues that high microbiome diversity—supported by varied plant
  fibers and fermented foods—is directly linked to metabolic health.
- **Fat Quality:** The speaker argues that demonizing dietary fat was a public health error that
  led to increased consumption of sugar and refined starch. He recommends healthy fats (olive
  oil, avocados, nuts, seeds, Omega-3s from cold-water fish) while advising against
  industrialized seed oils (soy, corn, canola, cottonseed) due to their pro-inflammatory nature.
- **Tracking and Strategy:** While he discourages lifetime calorie counting, Dr. Hyman suggests
  temporary tracking to correct the common 50% underestimation of food intake. He gives a simple
  visual heuristic: a palm-sized portion for protein, a fist for veggies, a cupped hand for
  carbs, and a thumb for fats.

### The Egg - A Short Story

**WATCH** — It's a memorable and unusual short story that manages to explain a complex
philosophical concept in a very simple and memorable way.

- **The nature of death and the afterlife:** A man who dies in a car accident encounters God in
  a void. God explains that death is not the end but a transition, and that all religious
  beliefs are partially correct in their own way.
- **The process of reincarnation:** The human soul is described as vast, magnificent, and much
  larger than a single human mind can contain. A human life is compared to a finger dipped into
  a glass of water—a temporary, limited experience used to gather knowledge and growth. Souls
  retain the experiences of all past lives, even if they cannot consciously recall them between
  incarnations.
- **The purpose of the universe:** God reveals that time is an illusion and that the universe
  was created as an “egg” for the individual soul to mature. The individual is reincarnated
  into every human who has ever lived or will live, across all of history. Every act of kindness
  or cruelty a person commits is done to themselves, as every other person is also a different
  incarnation of the same soul.
- **The ultimate goal:** The objective of this cycle of reincarnation is for the individual to
  grow and mature until they eventually reach the same level of existence as God. Once the soul
  has lived every human life throughout time, it will be “born” and become like God.

### Yoga For Complete Beginners

**WATCH** — It's an accessible, focused, and encouraging guided sequence that is for anyone
trying yoga for the first time.

- **Preparation and Breathing:** Begin by finding a comfortable cross-legged seat (Sukhasana).
  Focus on spinal alignment by stacking the head over the heart and the heart over the pelvis.
  Practice _Anjali Mudra_ (prayer hands) by lifting the sternum to the thumbs while keeping
  shoulders relaxed. The goal is to balance active strength with ease and calmness, using long,
  deep inhalations and exhalations.
- **Seated Movement:** Perform shoulder rolls and gentle neck stretches by tilting the ear
  toward the shoulder. Interlace fingers and reach upward, stretching the side body while
  grounding the thighs. Engage in gentle spinal twists by keeping the chest lifted and avoiding
  rounding the lower back; start by turning from the core rather than pulling the body into the
  position.
- **Tabletop and Spine Health:** Move to all fours with wrists under shoulders and knees under
  hips, spreading palms wide. Practice cat-cow (spinal flex) by inhaling to drop the belly while
  lifting the chest and exhaling to tuck the tailbone and round the spine. Ensure the neck
  remains a long extension of the spine throughout the movement.
- **Foot and Leg Engagement:** Practice stretching the calves by extending one leg back at a
  time while in the tabletop position, maintaining a strong, active core. Perform _Anahatasana_
  (heart-to-earth pose) to stretch the shoulders by keeping the hips high and melting the heart
  toward the floor.
- **Downward Dog:** Establish downward-facing dog by lifting the sit bones high while pressing
  firmly through the palms. Focus on maintaining a long spine rather than forcing the legs
  straight immediately. Use pedaling motions to warm up the legs and keep the head loose.
- **Mountain Pose and Standing Sequences:** In Mountain Pose (Tadasana), stand with feet
  hip-width apart and focus on grounding through all four corners of the feet. Use Volcano Pose
  (arms raised) to stretch the side body by grabbing wrists and pulling upward. For Warrior I
  and II, focus on a stable, wide stance with feet on two separate planes, engaging the inner
  thighs and tucking the pelvis to protect the lower back.

## Recommendation

- **Default:** keep `gemini-3.1-flash-lite` because it is the only requested model that actually
  ran and it produced useful, specific summaries on all eight varied caches.
- **Meaningful quality difference:** not measurable; 2.5 produced no content.
- **Measured speed difference:** not measurable; 3.1 averaged 2.632 seconds, while 2.5 only
  returned error responses.
- **Projected cost / 1,000:** 3.1 measured projection $4.2371, above the $3 threshold. 2.5 has no
  measured projection; its price-only proxy is $5.4201, also above $3.
