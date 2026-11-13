import { Box, CalendarDays, Coffee, SlidersHorizontal, Truck } from 'lucide-react';
import type { Category } from '../shared/chat';

export const topics = {
  'Выбор кофе': {
    icon: Coffee,
    prompts: ['Какой кофе выбрать без кислинки?', 'Что подойдёт для капучино?', 'Посоветуйте кофе с ягодными нотами'],
  },
  'Помол и заваривание': {
    icon: SlidersHorizontal,
    prompts: ['Какой помол нужен для эспрессо?', 'Как настроить помол для V60?', 'Какой помол выбрать для турки?'],
  },
  'Подписка': {
    icon: CalendarDays,
    prompts: ['Как устроена подписка?', 'Как выбрать интервал подписки?', 'Можно ли получать молотый кофе?'],
  },
  'Хранение кофе': {
    icon: Box,
    prompts: ['Как лучше хранить кофе дома?', 'Сколько кофе остаётся свежим?', 'Можно ли замораживать зёрна?'],
  },
  'Доставка и возвраты': {
    icon: Truck,
    prompts: ['Куда доставляет магазин?', 'Как узнать стоимость доставки?', 'Что делать, если заказ повреждён?'],
  },
} satisfies Record<Category, { icon: typeof Coffee; prompts: string[] }>;
