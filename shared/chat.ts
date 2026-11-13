export const categories = [
  'Выбор кофе',
  'Помол и заваривание',
  'Подписка',
  'Хранение кофе',
  'Доставка и возвраты',
] as const;

export type Category = (typeof categories)[number];
export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export const maxMessageLength = 1000;
export const maxAnswerLength = 2400;
export const maxHistoryLength = 8;
export const subscriptionIntervals = [2, 3, 4] as const;
export type SubscriptionInterval = (typeof subscriptionIntervals)[number];

export type Recommendation = {
  kind: 'coffee' | 'equipment' | 'subscription';
  summary: string;
  details: string[];
  intervalWeeks: SubscriptionInterval | null;
};

export type ChatRequest = {
  message: string;
  category: Category | null;
  history: ChatMessage[];
};

export type ChatResponse = {
  answer: string;
  recommendation: Recommendation | null;
};

export type HealthResponse = {
  status: 'ok';
  openaiConfigured: boolean;
  sheetConfigured: boolean;
};
