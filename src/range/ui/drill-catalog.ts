import type {Mode} from '../config';
export const drillCategories = [
  {id: 'warmup', label: 'Aim warm-up', modes: ['botz', 'redline', 'reflex']},
  {id: 'duel', label: 'AI Duel', modes: ['duel', 'deathmatch']},
  {id: 'range', label: 'Spray & movement', modes: ['guided', 'spray', 'transfer', 'peek', 'precision', 'burst']},
  {id: 'hearing', label: 'Hearing', modes: ['hearing']},
] as const;
export const categoryFor = (mode: Mode) => drillCategories.find(category => (category.modes as readonly Mode[]).includes(mode))!.id;
