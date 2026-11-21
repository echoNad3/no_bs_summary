import { describe, expect, it } from 'vitest';
import {
  assembleFactCards,
  factQualificationHints,
  formatSourceFragments,
  sourceFragments,
  requiredQualificationFragments,
  applyFactCompression,
  factResponseSchema,
  prepareFactSource,
} from '../src/summary/facts.js';
import { sourceBlocks } from '../src/summary/coverage.js';

const source =
  'Alex announced a planned sale to support Jo and the crew. Blair accused Alex of wrongdoing. Alex denied it. The host said Blair offered no evidence. Blair sold a chain. The host speculated Blair was experiencing a mental health crisis.';

function cards() {
  return {
    format: 'source_facts_v1',
    content_type: 'simple_story',
    coverage_groups: [{ id: 1, subject: 'Alex dispute', kind: 'story' }],
    excluded: [] as { start: number; end: number }[],
    qualifications: [
      {
        topic_id: 2,
        text: 'Alex denied it; the host said Blair offered no evidence.',
        evidence: 1,
      },
    ],
    topics: [
      {
        id: 1,
        coverage_group_id: 1,
        label: 'Planned sale',
        kind: 'event',
        text: 'Alex plans a sale to support Jo and the crew.',
        evidence: [1],
      },
      {
        id: 2,
        coverage_group_id: 1,
        label: 'Disputed claims',
        kind: 'event',
        text: 'Blair accused Alex of wrongdoing.',
        evidence: [1],
      },
      {
        id: 3,
        coverage_group_id: 1,
        label: 'Public behaviour',
        kind: 'event',
        text: 'Blair sold a chain.',
        evidence: [1],
      },
    ],
    verdict: 'SKIM',
    reason: 'Interesting dispute, but repeated reactions drag out the few concrete developments.',
  };
}

describe('source-backed fact cards', () => {
  it('retains an explicit speculation caveat without copying a first-person aside', () => {
    const draft = cards();
    draft.qualifications[0]!.text = 'Technically speculation, but I feel like it must be true.';
    const summary = assembleFactCards(
      draft,
      sourceBlocks(
        'The narrator said this is technically speculation, but I feel like it must be true.',
      ),
    );
    expect(summary.points[1]!.body).toContain(
      'The host says this identification remains speculation.',
    );
    expect(summary.points[1]!.body).not.toContain('I feel');
  });
  it('keeps all phases of a single story when the model gives them separate groups', () => {
    const draft = cards();
    draft.coverage_groups.push({ id: 2, subject: 'Public reaction', kind: 'story' });
    draft.topics[2]!.coverage_group_id = 2;
    const result = assembleFactCards(draft, sourceBlocks(source));
    expect(result.points).toHaveLength(3);
    for (const topic of draft.topics)
      expect(result.points.some(({ body }) => body.includes(topic.text))).toBe(true);
  });

  it('corrects an unrelated name in a denial when the captions explicitly identify a unique donor', () => {
    const draft = cards();
    draft.content_type = 'news_roundup';
    draft.coverage_groups.push({ id: 2, subject: 'Separate property case', kind: 'story' });
    const blocks = sourceBlocks(
      `The report named donor Dana Green. Green denied those allegations. ${'Earlier discussion. '.repeat(80)} Blair Moore was named in a property case.`,
    );
    draft.topics[2] = {
      id: 3,
      coverage_group_id: 2,
      label: 'Property case',
      kind: 'event',
      text: 'Blair Moore was named in a property case.',
      evidence: [5],
    };
    draft.qualifications = [
      { topic_id: 2, text: 'Blair Moore denied the allegations.', evidence: 1 },
    ];
    const result = assembleFactCards(draft, blocks);
    const text = result.points.map(({ body }) => body).join(' ');
    expect(text).toContain('Dana Green denied the allegations.');
    expect(text).not.toContain('Blair Moore denied');
  });

  it('splits a disproportionately long roundup story across adjacent paragraphs without detaching a caveat', () => {
    const data = cards();
    data.content_type = 'news_roundup';
    data.coverage_groups = Array.from({ length: 6 }, (_, i) => ({
      id: i + 1,
      subject: `Story ${i + 1}`,
      kind: 'story',
    }));
    data.topics = [1, 2, 3, 3, 3, 3, 4, 5, 6].map((group, i) => ({
      id: i + 1,
      coverage_group_id: group,
      label: `Fact ${i + 1}`,
      kind: 'event',
      text: `Fact ${i + 1} describes a concrete event ${'with details '.repeat(group === 3 ? 10 : 3).trim()}.`,
      evidence: [1],
    }));
    data.qualifications = [{ topic_id: 4, text: 'The evidence was disputed.', evidence: 1 }];
    const result = assembleFactCards(
      data,
      sourceBlocks('Original reporting and fuller context. '.repeat(180)),
    );
    expect(result.points).toHaveLength(5);
    const words = result.points.map(({ body }) => body.split(/\s+/u).length);
    expect(Math.max(...words) / Math.min(...words)).toBeLessThan(2);
    const paragraph = result.points.find(({ body }) => body.includes('Fact 4 describes'));
    expect(paragraph?.body).toContain('The evidence was disputed.');
    for (const topic of data.topics)
      expect(result.points.filter(({ body }) => body.includes(topic.text))).toHaveLength(1);
  });

  it('removes a confirmed lawsuit recruitment pitch including its verdict lead-in before generation', () => {
    const before = 'The court ordered the city to release documents.';
    const after = 'And again, back to reporting about the case.';
    const blocks = sourceBlocks(
      `${before} And speaking of lawsuits a jury reached a major platform verdict. Check if you qualify for compensation. Scan the QR code to sign up. ${after}`,
    );
    const prepared = prepareFactSource(blocks);
    expect(prepared.ads).toHaveLength(1);
    expect(prepared.promptText).toContain(before);
    expect(prepared.promptText).toContain(after);
    expect(prepared.promptText).not.toContain('platform verdict');
    expect(
      prepareFactSource(
        sourceBlocks(
          `${before} And speaking of lawsuits another court released its ruling. ${after}`,
        ),
      ).ads,
    ).toHaveLength(0);
    const data = cards();
    data.qualifications = [];
    data.topics[0]!.evidence = [prepared.ads[0]!.start];
    expect(() => assembleFactCards(data, blocks, prepared)).toThrow('excluded commercial text');
  });

  it('drops a misattributed clinical clause without losing the denial or observable actions', () => {
    const data = cards();
    const blocks = sourceBlocks(`${source} The allegations became a dispute on Instagram.`);
    data.topics[1]!.text =
      'Alex denied the allegations, calling them lies and suggesting Blair was experiencing a mental health crisis.';
    const result = assembleFactCards(data, blocks);
    const bodies = result.points.map((point) => point.body).join(' ');
    expect(result.points).toHaveLength(3);
    expect(bodies).toContain('Alex denied the allegations, calling them lies.');
    expect(bodies).toContain('Blair sold a chain.');
    expect(bodies).not.toContain('mental health crisis');
  });

  it('preserves the event while discarding a false relative date', () => {
    const blocks = sourceBlocks(
      'A podcast aired two months ago. The report came out three weeks after the event.',
    );
    const data = cards();
    data.qualifications = [];
    data.topics[0]!.text = 'Two months prior to the investigation, a podcast aired.';
    data.topics[1]!.text = 'Three weeks after the event, the report came out.';
    data.topics[2]!.text = 'The podcast aired two months ago.';
    const result = assembleFactCards(data, blocks);
    expect(result.points.map(({ body }) => body)).toEqual([
      'A podcast aired.',
      'Three weeks after the event, the report came out.',
      'The podcast aired two months ago.',
    ]);
  });

  it('does not extend one person’s separate unfollow to the whole team', () => {
    const blocks = sourceBlocks(
      'The entire team unfollowed a cast member and Jo recently unfollowed them as well, as well as also unfollowing Alex.',
    );
    const data = cards();
    data.qualifications = [];
    data.topics[0]!.text = 'The team and Jo recently unfollowed both Blair and Alex.';
    data.topics[1]!.text = 'Jo also unfollowed Alex.';
    const result = assembleFactCards(data, blocks);
    expect(result.points[0]!.body).toBe('The team and Jo recently unfollowed Blair.');
    expect(result.points[1]!.body).toBe('Jo also unfollowed Alex.');
  });

  it('preserves every source word, order and exact character location across blocks and cues', () => {
    const text = `${'ordinary source words '.repeat(260)}And speaking of lawsuits this is a sponsor. And again, back to the main discussion. ${'ending words '.repeat(75)}`;
    const blocks = sourceBlocks(text);
    const normalized = blocks.join(' ');
    const fragments = sourceFragments(blocks);
    expect(fragments.map((fragment) => fragment.text).join(' ')).toBe(normalized);
    for (const [index, fragment] of fragments.entries()) {
      expect(fragment.id).toBe(index + 1);
      expect(normalized.slice(fragment.start, fragment.end)).toBe(fragment.text);
      expect(fragment.text.split(/\s+/u).length).toBeLessThanOrEqual(40);
    }
    expect(fragments.some((f) => f.text.startsWith('And speaking of lawsuits'))).toBe(true);
    expect(fragments.some((f) => f.text.startsWith('And again, back to'))).toBe(true);
    expect(formatSourceFragments(blocks)).toContain('[S1] ordinary');
    expect(formatSourceFragments(blocks)).not.toContain('SOURCE BLOCK');
  });

  it('assembles exactly three paragraphs and keeps the caveat with its claim without rewriting', () => {
    const result = assembleFactCards(cards(), sourceBlocks(source));
    expect(result.points).toHaveLength(3);
    expect(result.points[0]!.body).toBe(cards().topics[0]!.text);
    expect(result.points[1]!.body).toBe(
      `${cards().topics[1]!.text} ${cards().qualifications[0]!.text}`,
    );
    expect(result.points[2]!.body).toBe(cards().topics[2]!.text);
    expect(factQualificationHints(sourceBlocks(source))).toContain(1);
  });

  it.each(['topic', 'qualification', 'commercial start', 'commercial end'])(
    'rejects nonexistent source IDs for %s',
    (field) => {
      const data = cards();
      if (field === 'topic') data.topics[0]!.evidence = [999];
      if (field === 'qualification') data.qualifications[0]!.evidence = 999;
      if (field === 'commercial start') data.excluded = [{ start: 999, end: 999 }];
      if (field === 'commercial end') data.excluded = [{ start: 1, end: 999 }];
      expect(() => assembleFactCards(data, sourceBlocks(source))).toThrow(
        'original source fragment',
      );
    },
  );

  it('rejects invalid references before grouping, including duplicate and unused IDs', () => {
    const invalid = [
      { ...cards(), topics: [...cards().topics, cards().topics[0]] },
      { ...cards(), coverage_groups: [...cards().coverage_groups, cards().coverage_groups[0]] },
      { ...cards(), coverage_groups: [{ id: 99, subject: 'Unknown', kind: 'story' }] },
      {
        ...cards(),
        coverage_groups: [...cards().coverage_groups, { id: 99, subject: 'Unused', kind: 'story' }],
      },
      { ...cards(), qualifications: [{ topic_id: 99, text: 'Uncertainty.', evidence: 1 }] },
    ];
    for (const data of invalid)
      expect(() => assembleFactCards(data, sourceBlocks(source))).toThrow();
  });

  it('rejects reversed and overlapping commercial ranges and any facts or caveats citing them', () => {
    const blocks = sourceBlocks(source);
    for (const excluded of [
      [{ start: 2, end: 1 }],
      [{ start: 1, end: 1 }],
      [
        { start: 1, end: 2 },
        { start: 2, end: 2 },
      ],
    ]) {
      expect(() => assembleFactCards({ ...cards(), excluded }, blocks)).toThrow();
    }
    const data = cards();
    data.qualifications = [];
    data.excluded = [{ start: 1, end: 1 }];
    expect(() => assembleFactCards(data, blocks)).toThrow('excluded commercial text');
  });

  it('resolves repeated source text by its actual ID rather than ambiguous copied quotes', () => {
    const repeated = Array.from({ length: 120 }, () => 'repeat').join(' ');
    const data = cards();
    data.qualifications = [];
    data.excluded = [{ start: 2, end: 2 }];
    data.topics.forEach((topic) => {
      topic.evidence = [1];
    });
    expect(assembleFactCards(data, sourceBlocks(repeated)).points).toHaveLength(3);
  });

  it('groups all ten stories into five balanced paragraphs and keeps every qualification', () => {
    const data = cards();
    data.content_type = 'news_roundup';
    data.coverage_groups = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      subject: `Story ${i + 1}`,
      kind: 'story',
    }));
    data.topics = data.coverage_groups.map((group) => ({
      id: group.id,
      coverage_group_id: group.id,
      label: group.subject,
      kind: 'event',
      text: `Actor ${group.id} took a concrete action with a distinct outcome.`,
      evidence: [1],
    }));
    data.qualifications = [{ topic_id: 4, text: 'The claim remains disputed.', evidence: 1 }];
    const result = assembleFactCards(data, sourceBlocks(`${source} ${'context '.repeat(900)}`));
    expect(result.points).toHaveLength(5);
    const prose = result.points.map((point) => point.body).join(' ');
    for (const topic of data.topics) expect(prose.split(topic.text)).toHaveLength(2);
    expect(result.points.find((point) => point.body.includes('Actor 4'))!.body).toContain(
      'The claim remains disputed.',
    );
  });

  it('keeps three paragraphs for a short roundup even when it inventories ten stories', () => {
    const data = cards();
    data.content_type = 'news_roundup';
    data.coverage_groups = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      subject: `Story ${i + 1}`,
      kind: 'story',
    }));
    data.topics = data.coverage_groups.map((group) => ({
      id: group.id,
      coverage_group_id: group.id,
      label: group.subject,
      kind: 'event',
      text: `Actor ${group.id} acted.`,
      evidence: [1],
    }));
    expect(
      assembleFactCards(data, sourceBlocks(source.replace('denied', 'answered'))).points,
    ).toHaveLength(3);
  });

  it.each([
    'Observers speculated Blair was experiencing a mental health crisis.',
    'The host attributed the behaviour to a mental health crisis.',
    'Blair sold a chain; observers viewed the behaviour as a mental health crisis.',
  ])('accepts explicit same-sentence interpretations: %s', (text) => {
    const data = cards();
    data.topics[2]!.text = text;
    expect(assembleFactCards(data, sourceBlocks(source)).points[2]!.body).toBe(text);
  });

  it.each([
    'Blair is experiencing a mental health crisis.',
    'Blair is experiencing a mental health crisis. The host said so.',
  ])('rejects an unqualified diagnosis: %s', (text) => {
    const data = cards();
    data.topics[2]!.text = text;
    expect(() => assembleFactCards(data, sourceBlocks(source))).toThrow(
      'mental-health interpretation',
    );
  });

  it('requires explicit noncommercial source denials and evidence limitations to survive compression', () => {
    const data = cards();
    data.qualifications = [];
    expect(requiredQualificationFragments(sourceBlocks(source))).toContain(1);
    expect(() => assembleFactCards(data, sourceBlocks(source))).toThrow(
      'Preserve the explicit denial',
    );
    data.qualifications = cards().qualifications;
    expect(assembleFactCards(data, sourceBlocks(source)).points[1]!.body).toContain(
      'offered no evidence',
    );
  });

  it('rejects a denial assigned to a person named only in a different story', () => {
    const data = cards();
    data.content_type = 'news_roundup';
    data.coverage_groups.push({ id: 2, subject: 'Building sale', kind: 'story' });
    data.topics[2] = {
      id: 3,
      coverage_group_id: 2,
      label: 'Building sale',
      kind: 'event',
      text: 'Dana Green sold the building.',
      evidence: [5],
    };
    data.qualifications[0]!.text = 'Dana Green denied it.';
    const blocks = sourceBlocks(
      `${source} ${'additional context '.repeat(70)} Dana Green sold the building.`,
    );
    expect(() => assembleFactCards(data, blocks)).toThrow('name from an unrelated story');

    data.topics[0]!.text = 'The original account includes this further detail. '.repeat(30);
    expect(() => assembleFactCards(data, blocks)).toThrow(
      /name from an unrelated story[\s\S]*at most 210 words/u,
    );
  });

  it('requires coverage of a later explicitly introduced story and allows a marked sponsor break', () => {
    const blocks = sourceBlocks(
      `${source} ${'earlier discussion '.repeat(70)} Finally today a city council approved a transit extension.`,
    );
    const anchor = sourceFragments(blocks).find((part) => part.text.includes('Finally today'))!.id;
    const data = cards();
    data.content_type = 'news_roundup';
    expect(() => assembleFactCards(data, blocks)).toThrow('no emitted story cites its opening');
    const excluded = [{ start: anchor, end: anchor }];
    expect(assembleFactCards({ ...data, excluded }, blocks).points).toHaveLength(3);
    data.coverage_groups.push({ id: 2, subject: 'Transit extension', kind: 'story' });
    data.topics.push({
      id: 4,
      coverage_group_id: 2,
      label: 'Transit extension',
      kind: 'event',
      text: 'A city council approved a transit extension.',
      evidence: [anchor],
    });
    expect(
      assembleFactCards(data, blocks)
        .points.map((point) => point.body)
        .join(' '),
    ).toContain('approved a transit extension');
  });

  it('adds missing sentence separators without changing factual words', () => {
    const data = cards();
    data.topics[1]!.text = 'Blair accused Alex of wrongdoing';
    data.qualifications[0]!.text = 'Alex denied it; the host said Blair offered no evidence';
    expect(assembleFactCards(data, sourceBlocks(source)).points[1]!.body).toBe(
      'Blair accused Alex of wrongdoing. Alex denied it; the host said Blair offered no evidence.',
    );
  });

  it('compresses prose by original ID while keeping all protected fields in code', () => {
    const original = factResponseSchema.parse(cards());
    const edits = cards().topics.map(({ id, label, text }) => ({ id, label, text }));
    edits[0]!.text = 'Alex plans support for Jo and the crew.';
    const changed = {
      qualifications: [],
      topics: [...edits].reverse().map((edit) => ({ ...edit, kind: 'attributed', evidence: [9] })),
    };
    const result = applyFactCompression(original, changed);
    expect(result).toEqual({
      ...original,
      topics: original.topics.map((topic, index) => ({ ...topic, ...edits[index] })),
    });
    expect(() => applyFactCompression(original, { topics: edits.slice(1) })).toThrow();
    expect(() =>
      applyFactCompression(original, { topics: [edits[0], edits[0], edits[2]] }),
    ).toThrow();
    expect(() =>
      applyFactCompression(original, { topics: [edits[0], edits[1], { ...edits[2], id: 99 }] }),
    ).toThrow();
  });
});
