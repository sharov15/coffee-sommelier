import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import {
  ArrowRight, ArrowUp, CircleAlert, Coffee, Compass, RotateCcw, Sparkles,
} from 'lucide-react';
import { categories, maxHistoryLength, maxMessageLength, subscriptionIntervals } from '../shared/chat';
import type { Category, ChatMessage, ChatRequest, ChatResponse, HealthResponse, Recommendation } from '../shared/chat';
import { topics } from './topics';

const recommendationLabels = {
  coffee: 'Вкусовой профиль',
  equipment: 'Оборудование и заваривание',
  subscription: 'Подписка на кофе',
};

function RecommendationCard({ recommendation }: { recommendation: Recommendation | null }) {
  return (
    <aside className="recommendation" aria-labelledby="recommendation-title">
      <h2 className="side-heading" id="recommendation-title">Рекомендация</h2>
      <div className="recommendation-card">
        <div className="recommendation-photo" aria-hidden="true">
          <img src="/roasted-coffee.jpg" alt="" width="750" height="500" />
        </div>
        <div className="recommendation-body" aria-live="polite">
          <span className="recommendation-icon"><Sparkles size={19} aria-hidden="true" /></span>
          {recommendation ? (
            <>
              <p className="recommendation-kind">{recommendationLabels[recommendation.kind]}</p>
              <h3>{recommendation.summary}</h3>
              {recommendation.details.length > 0 && (
                <ul className="recommendation-details">
                  {recommendation.details.map((detail, index) => <li key={index}>{detail}</li>)}
                </ul>
              )}
              {recommendation.kind === 'subscription' && (
                <ul className="intervals" aria-label="Интервалы подписки">
                  {subscriptionIntervals.map((weeks) => (
                    <li key={weeks} className={weeks === recommendation.intervalWeeks ? 'chosen' : ''}>
                      {weeks} недели{weeks === recommendation.intervalWeeks && <span className="sr-only"> — рекомендовано</span>}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <h3>Подбор для Вас</h3>
              <p>Когда консультант предложит кофе, оборудование или подписку, рекомендация появится здесь.</p>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

function connectionLabel(health: HealthResponse | 'offline' | null) {
  if (!health) return 'Проверяем подключение';
  if (health === 'offline') return 'Сервер недоступен';
  if (!health.openaiConfigured || !health.sheetConfigured) return 'Чат требует настройки';
  return 'Чат готов к работе';
}

export function App() {
  const [category, setCategory] = useState<Category>('Выбор кофе');
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<ChatRequest | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [health, setHealth] = useState<HealthResponse | 'offline' | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const currentRequest = useRef<AbortController | null>(null);
  const ready = health && health !== 'offline' && health.openaiConfigured && health.sheetConfigured;

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
      .then(async (response) => {
        if (!response.ok) throw new Error('Health check failed');
        const data = await response.json() as HealthResponse;
        if (data.status !== 'ok') throw new Error('Invalid health response');
        if (!controller.signal.aborted) setHealth(data);
      })
      .catch(() => { if (!controller.signal.aborted) setHealth('offline'); });
    return () => {
      controller.abort();
      currentRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    const log = timeline.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [history, pending, sending, error]);

  async function send(request: ChatRequest) {
    if (currentRequest.current) return;
    const controller = new AbortController();
    currentRequest.current = controller;
    setError('');
    setSending(true);
    setPending(request);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(38_000)]),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'Сервер временно недоступен. Попробуйте ещё раз.');
        return;
      }
      const result = data as ChatResponse | null;
      if (typeof result?.answer !== 'string' || !result.answer.trim()) {
        setError('Не удалось прочитать ответ. Попробуйте ещё раз.');
        return;
      }
      setHistory((previous) => [
        ...previous,
        { role: 'user', content: request.message },
        { role: 'assistant', content: result.answer },
      ]);
      setRecommendation(result.recommendation);
      setPending(null);
      setHealth({ status: 'ok', openaiConfigured: true, sheetConfigured: true });
    } catch (requestError) {
      if (controller.signal.aborted) return;
      setError(requestError instanceof DOMException && requestError.name === 'TimeoutError'
        ? 'Ответ занял слишком много времени. Попробуйте ещё раз.'
        : 'Не удалось связаться с сервером. Проверьте соединение и попробуйте ещё раз.');
    } finally {
      currentRequest.current = null;
      setSending(false);
    }
  }

  function submit(text: string) {
    const message = text.trim();
    if (!message || currentRequest.current) return;
    setDraft('');
    void send({ message, category, history: history.slice(-maxHistoryLength) });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submit(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit(draft);
  }

  function reset() {
    setHistory([]);
    setPending(null);
    setDraft('');
    setError('');
    setRecommendation(null);
    composer.current?.focus();
  }

  return (
    <>
      <header className="topbar">
        <div className="page-width topbar-inner">
          <div className="brand">
            <img src="/coffee.svg" width="42" height="42" alt="" />
            <span>Кофейный сомелье</span>
          </div>
          <div className={`connection ${ready ? 'connection-ready' : ''}`} role="status">
            <span aria-hidden="true" />{connectionLabel(health)}
          </div>
        </div>
      </header>

      <main className="page-width">
        <div className="intro">
          <h1>Найдём <em>Ваш кофе</em></h1>
          <p>Подберём зерно по вкусу, поможем с помолом, завариванием и подпиской.</p>
        </div>

        <div className="workspace">
          <nav className="topics" aria-label="Темы консультации">
            <h2 className="side-heading">Темы консультации</h2>
            <div className="topic-list">
              {categories.map((item) => {
                const Icon = topics[item].icon;
                return (
                  <button key={item} type="button" className="topic-button" aria-pressed={category === item}
                    onClick={() => setCategory(item)}>
                    <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
                    <span>{item}</span>
                  </button>
                );
              })}
            </div>
          </nav>

          <section className="chat" aria-labelledby="chat-title">
            <div className="chat-header">
              <span className="chat-avatar"><Coffee size={22} strokeWidth={1.7} aria-hidden="true" /></span>
              <div className="chat-heading">
                <h2 id="chat-title">Чат с сомелье</h2>
                <p>Консультант магазина</p>
              </div>
              <button className="reset-button" type="button" title="Новый диалог" aria-label="Новый диалог"
                disabled={sending || !(history.length || pending || draft)} onClick={reset}>
                <RotateCcw size={17} strokeWidth={1.8} aria-hidden="true" />
                <span>Новый диалог</span>
              </button>
            </div>

            <div className="timeline" ref={timeline}>
              <div className="chat-welcome">
                <span className="message-avatar"><Coffee size={16} strokeWidth={1.7} aria-hidden="true" /></span>
                <div className="bubble">
                  <strong>Здравствуйте!</strong>
                  <p>Расскажите, как Вы готовите кофе и какие вкусы любите. Можно начать с одного из вопросов ниже.</p>
                </div>
              </div>

              {!history.length && !pending && (
                <div className="suggestions" aria-label="Примеры вопросов">
                  {topics[category].prompts.map((prompt) => (
                    <button key={prompt} type="button" onClick={() => submit(prompt)}>
                      {prompt}<ArrowRight size={15} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}

              <div className="messages" role="log" aria-label="История сообщений" aria-live="polite">
                {history.map(({ role, content }, index) => (
                  <div key={index} className={`message message-${role}`}>
                    {role === 'assistant' && <span className="message-avatar"><Coffee size={16} strokeWidth={1.7} aria-hidden="true" /></span>}
                    <div className="bubble"><span className="sr-only">{role === 'user' ? 'Вы: ' : 'Сомелье: '}</span>{content}</div>
                  </div>
                ))}
                {pending && <div className="message message-user"><div className="bubble">{pending.message}</div></div>}
              </div>
              {sending && (
                <div className="thinking" role="status">
                  <span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>
                  Сомелье готовит ответ
                </div>
              )}
              {error && (
                <div className="chat-error">
                  <div role="alert"><CircleAlert size={16} aria-hidden="true" />{error}</div>
                  {pending && <button type="button" onClick={() => void send(pending)}>Повторить</button>}
                </div>
              )}
            </div>

            <form className="composer" onSubmit={onSubmit}>
              <div className="composer-field">
                <label className="sr-only" htmlFor="question">Сообщение сомелье</label>
                <textarea ref={composer} id="question" rows={1} maxLength={maxMessageLength}
                  placeholder="Напишите Ваш вопрос…" value={draft}
                  onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} />
                <button type="submit" className="send-button" disabled={sending || !draft.trim()} aria-label="Отправить сообщение">
                  <ArrowUp size={21} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
              <div className="composer-hint"><span>Enter — отправить · Shift + Enter — новая строка</span><span>{draft.length} / {maxMessageLength}</span></div>
            </form>
          </section>

          <RecommendationCard recommendation={recommendation} />
        </div>

        <footer className="footer">
          <span><Coffee size={15} aria-hidden="true" /> Кофейный сомелье</span>
          <span><Compass size={15} aria-hidden="true" /> Учебный проект</span>
        </footer>
      </main>
    </>
  );
}
