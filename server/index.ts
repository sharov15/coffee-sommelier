import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import OpenAI from 'openai';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { categories, maxAnswerLength, maxHistoryLength, maxMessageLength } from '../shared/chat.js';
import { askAssistant } from './assistant.js';
import { createKnowledgeSource, findRelevantRows } from './knowledge.js';

const port = Number(process.env.PORT || 3000);
const apiKey = process.env.OPENAI_API_KEY?.trim();
const model = process.env.OPENAI_MODEL?.trim() || 'gpt-6-luna';
const csvUrl = process.env.SHEET_CSV_URL?.trim();
const client = apiKey ? new OpenAI({ apiKey, timeout: 25000, maxRetries: 0 }) : null;
const loadKnowledge = createKnowledgeSource(csvUrl);
const app = express();

app.disable('x-powered-by');
if (process.env.RENDER === 'true') app.set('trust proxy', 1);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const requestSchema = z.object({
  message: z.string().trim().min(1).max(maxMessageLength),
  category: z.enum(categories).nullable().default(null),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(maxAnswerLength),
  }).refine(({ role, content }) => role === 'assistant' || content.length <= maxMessageLength))
    .max(maxHistoryLength).default([]),
});

const chatLimit = rateLimit({
  windowMs: 60_000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { code: 'RATE_LIMIT', error: 'Слишком много сообщений. Подождите минуту и попробуйте снова.' },
});

let activeChats = 0;

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', openaiConfigured: Boolean(client), sheetConfigured: Boolean(csvUrl) });
});

app.post('/api/chat', chatLimit, express.json({ limit: '96kb' }), async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      code: 'INVALID_MESSAGE',
      error: `Введите сообщение длиной от 1 до ${maxMessageLength} символов. Если ошибка повторится, начните новый диалог.`,
    });
  }
  if (!client) {
    return res.status(503).json({ code: 'OPENAI_NOT_CONFIGURED', error: 'Чат ещё не настроен. Укажите OPENAI_API_KEY на сервере.' });
  }
  if (!csvUrl) {
    return res.status(503).json({ code: 'SHEET_NOT_CONFIGURED', error: 'База знаний не настроена. Укажите SHEET_CSV_URL на сервере.' });
  }
  if (activeChats >= 6) {
    res.setHeader('Retry-After', '10');
    return res.status(503).json({ code: 'BUSY', error: 'Консультант сейчас занят. Попробуйте через несколько секунд.' });
  }

  const request = parsed.data;
  const controller = new AbortController();
  res.once('close', () => controller.abort());
  activeChats += 1;

  try {
    let rows;
    try {
      rows = await loadKnowledge();
    } catch (error) {
      console.error('Knowledge CSV:', error instanceof Error ? error.name : 'UnknownError');
      return res.status(503).json({
        code: 'SHEET_UNAVAILABLE',
        error: 'База знаний магазина сейчас недоступна. Попробуйте позже. Если ошибка сохраняется, проверьте доступ к CSV Google Sheets.',
      });
    }

    if (controller.signal.aborted) return;
    const recentQuestion = request.history.findLast((message) => message.role === 'user')?.content;
    const knowledge = findRelevantRows(rows, request.message, request.category, recentQuestion);
    const result = await askAssistant(client, model, request, knowledge, controller.signal);
    if (!controller.signal.aborted) res.json(result);
  } catch (error) {
    if (controller.signal.aborted) return;
    console.error('OpenAI:', error instanceof OpenAI.APIError ? error.status ?? error.name : 'Unexpected response');
    if (error instanceof OpenAI.APIConnectionTimeoutError) {
      return res.status(504).json({ code: 'AI_TIMEOUT', error: 'Консультант не успел ответить. Попробуйте ещё раз.' });
    }
    if (error instanceof OpenAI.APIError) {
      if (error.status === 401 || error.status === 403 || error.status === 404) {
        return res.status(503).json({ code: 'AI_ACCESS', error: 'Консультант недоступен. Проверьте ключ OpenAI и доступ к настроенной модели.' });
      }
      if (error.status === 429) {
        return res.status(503).json({ code: 'AI_LIMIT', error: 'Достигнут лимит OpenAI. Попробуйте позже или проверьте лимиты и баланс проекта.' });
      }
    }
    res.status(502).json({ code: 'AI_UNAVAILABLE', error: 'Не удалось получить ответ консультанта. Попробуйте ещё раз.' });
  } finally {
    activeChats -= 1;
  }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Маршрут API не найден.' }));

const staticDirectory = resolve('dist-web');
const indexFile = resolve(staticDirectory, 'index.html');
if (existsSync(indexFile)) {
  app.use(express.static(staticDirectory));
  app.get('/{*path}', (req, res, next) => {
    if (!req.accepts('html') || /\.[^/]+$/.test(req.path)) return next();
    res.sendFile(indexFile);
  });
}

const handleError: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === 'entity.too.large') {
    res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', error: 'Сообщение слишком большое. Сократите текст и повторите отправку.' });
    return;
  }
  if (error.status === 400 || error.status === 415) {
    res.status(400).json({ code: 'INVALID_BODY', error: 'Не удалось прочитать сообщение. Отправьте его ещё раз.' });
    return;
  }
  console.error('Express:', error instanceof Error ? error.name : 'UnknownError');
  res.status(500).json({ code: 'SERVER_ERROR', error: 'Произошла ошибка сервера. Попробуйте позже.' });
};
app.use(handleError);

app.listen(port, '0.0.0.0', () => {
  console.log(`Кофейный сомелье · http://localhost:${port}`);
});
