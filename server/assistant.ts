import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import {
  maxAnswerLength, subscriptionIntervals,
} from '../shared/chat.js';
import type { ChatRequest, ChatResponse, Recommendation } from '../shared/chat.js';
import type { KnowledgeRow } from './knowledge.js';
import { systemPrompt } from './system-prompt.js';

const outputSchema = z.object({
  answer: z.string().min(1).max(maxAnswerLength),
  recommendation: z.object({
    kind: z.enum(['coffee', 'equipment', 'subscription']),
    sourceId: z.number().int(),
    summary: z.string().min(1).max(140),
    details: z.array(z.string().min(1).max(70)).max(3),
    intervalWeeks: z.union([
      z.literal(subscriptionIntervals[0]),
      z.literal(subscriptionIntervals[1]),
      z.literal(subscriptionIntervals[2]),
    ]).nullable(),
  }).nullable(),
});

const categoryByKind = {
  coffee: 'Выбор кофе',
  equipment: 'Помол и заваривание',
  subscription: 'Подписка',
} as const;

function supportedRecommendation(
  candidate: z.infer<typeof outputSchema>['recommendation'],
  knowledge: KnowledgeRow[],
): Recommendation | null {
  if (!candidate) return null;
  const { sourceId, kind, summary, details, intervalWeeks } = candidate;
  const source = knowledge.find((row) => row.id === sourceId);
  if (source?.category !== categoryByKind[kind]) return null;

  const commercialDetails = /https?:\/\/|www\.|\S+\.(?:ru|com|shop)\b|[₽€$]|\d\s*(?:рубл|руб\.|р\.)/iu;
  const normalizedSource = source.answer.toLowerCase().replace(/\s+/g, ' ');
  const excerpts = [...new Set([summary, ...details].map((value) => value.trim().replace(/\s+/g, ' ')))]
    .filter((value) => value && normalizedSource.includes(value.toLowerCase()) && !commercialDetails.test(value));
  const [title, ...facts] = excerpts;
  if (!title) return null;

  return {
    kind, summary: title[0].toUpperCase() + title.slice(1), details: facts,
    intervalWeeks: kind === 'subscription' ? intervalWeeks : null,
  };
}

export async function askAssistant(
  client: OpenAI,
  model: string,
  request: ChatRequest,
  knowledge: KnowledgeRow[],
  signal: AbortSignal,
): Promise<ChatResponse> {
  const response = await client.responses.parse({
    model,
    reasoning: { effort: 'low' },
    instructions: systemPrompt,
    input: [{ role: 'user', content: JSON.stringify({ ...request, knowledge }) }],
    text: { format: zodTextFormat(outputSchema, 'coffee_consultation') },
    max_output_tokens: 1200,
    store: false,
  }, { signal });

  const output = response.output_parsed;
  if (response.status !== 'completed' || !output?.answer.trim()) {
    throw new Error('OpenAI did not return a complete structured answer');
  }

  return {
    answer: output.answer.trim(),
    recommendation: supportedRecommendation(output.recommendation, knowledge),
  };
}
