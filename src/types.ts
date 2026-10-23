export type Card = {
  id: string;
  deck: string;
  front: string;
  back: string;
  pinyin?: string;
  note?: string;
  box: number;
  due_at: string;
  lapses: number;
  reps: number;
  updated_at?: string;
};

export type Changes = {
  cards: Card[];
  deleted: string[];
  now: number;
};

export type DayStat = {
  date: string;
  known: number;
  unknown: number;
};

export type HardCard = {
  id: string;
  front: string;
  back: string;
  lapses: number;
};

export type Stats = {
  total: number;
  due_now: number;
  new: number;
  answers: number;
  known_rate: number;
  streak: number;
  days: DayStat[];
  hardest: HardCard[];
};

export type Config = {
  baseUrl: string;
  token: string;
};
