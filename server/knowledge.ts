import { parse } from 'csv-parse/sync';
import { newStemmer } from 'snowball-stemmers';
import type { Category } from '../shared/chat.js';

export type KnowledgeRow = {
  id: number;
  category: string;
  question: string;
  answer: string;
  tags: string;
};

const fields = ['category', 'question', 'answer', 'tags'] as const;
const cacheTtlMs = 5 * 60 * 1000;
const maxContextRows = 20;
const russian = newStemmer('russian');
const stopWords = new Set(
  'а в во и или с со из за по на от для о об у к не но как какой какая какие что это я мы вы мне мой если ли можно кофе часто лучше узнать'.split(' '),
);
const synonyms: Record<string, string> = {
  заморажива: 'замороз',
  замораживай: 'замороз',
  заморозк: 'замороз',
  замороз: 'замороз',
  морозильник: 'замороз',
};

export function createKnowledgeSource(url: string | undefined) {
  let cache: { rows: KnowledgeRow[]; expiresAt: number } | undefined;
  let pending: Promise<KnowledgeRow[]> | undefined;

  async function download() {
    if (!url) throw new Error('Missing SHEET_CSV_URL');
    const source = new URL(url);
    if (!['http:', 'https:'].includes(source.protocol)) {
      throw new Error('Unsupported CSV URL scheme');
    }

    const response = await fetch(source, {
      signal: AbortSignal.timeout(7000),
      headers: { accept: 'text/csv' },
    });
    if (!response.ok) throw new Error(`CSV download returned HTTP ${response.status}`);
    if (response.headers.get('content-type')?.includes('text/html')) {
      throw new Error('Expected CSV, received HTML');
    }

    const csvRows = parse(await response.text(), {
      bom: true,
      skip_empty_lines: true,
      trim: true,
      max_record_size: 16_000,
      columns(headers: string[]) {
        if (!fields.every((field) => headers.includes(field))) {
          throw new Error('CSV headers do not match the expected fields');
        }
        return headers.map((header) => fields.some((field) => field === header) ? header : false);
      },
    }) as Record<(typeof fields)[number], string>[];

    const rows = csvRows
      .filter((row) => row.category && row.question && row.answer)
      .map(({ category, question, answer, tags }, index) => ({
        id: index + 1,
        category,
        question,
        answer,
        tags,
      }));
    if (!rows.length) throw new Error('The CSV contains no usable rows');

    cache = { rows, expiresAt: Date.now() + cacheTtlMs };
    return rows;
  }

  return async () => {
    if (cache && Date.now() < cache.expiresAt) return cache.rows;
    pending ??= download().finally(() => { pending = undefined; });
    return pending;
  };
}

function tokens(text: string) {
  const words = text.toLowerCase().replaceAll('ё', 'е').match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(
    words.filter((word) => !stopWords.has(word) && (word.length >= 2 || /^[234]$/.test(word)))
      .map((word) => {
        const stem = /[а-я]/.test(word) ? russian.stem(word) : word;
        return synonyms[stem] ?? stem;
      }),
  );
}

export function findRelevantRows(
  rows: KnowledgeRow[],
  message: string,
  category: Category | null,
  recentQuestion = '',
) {
  const query = tokens(message);
  const context = tokens(recentQuestion);
  const phrase = message.toLowerCase().trim().replace(/[?!.,]+$/, '');
  const parts = message.split(/[.!?…;,\n]+|\s+(?:а также|а ещ[её]|и|а|но|также)\s+/iu)
    .map(tokens)
    .filter((part) => part.size > 0);

  const ranked = rows.map((row) => {
    const tags = tokens(row.tags);
    const question = tokens(row.question);
    const answer = tokens(row.answer);
    const scoreWords = (words: Set<string>) => [...words].reduce((score, word) =>
      score + (tags.has(word) ? 5 : 0) + (question.has(word) ? 3 : 0) + (answer.has(word) ? 1 : 0), 0);
    const direct = scoreWords(query);
    const followUp = scoreWords(context);
    const categoryBoost = category === row.category ? 2.5 : 0;
    const phraseBoost = phrase.length >= 12 && row.question.toLowerCase().includes(phrase) ? 8 : 0;
    const score = direct + (direct ? 0.12 : 0.35) * followUp + categoryBoost + phraseBoost;
    return { row, score, scoreWords };
  });

  const overall = ranked
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map(({ row }) => row);

  if (parts.length < 2) return overall;

  const byPart = parts.map((part) => ranked
    .map(({ row, scoreWords }) => ({ row, score: scoreWords(part) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map(({ row }) => row));

  // Give each part a source before adding any part's second match.
  const primary = byPart.flatMap(([first]) => first ? [first] : []);
  const secondary = byPart.flatMap(([, second]) => second ? [second] : []);
  return [...new Set([...primary, ...overall, ...secondary])].slice(0, maxContextRows);
}
