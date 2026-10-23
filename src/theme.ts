export type Palette = {
  dark: boolean;
  paper: string;
  paperDeep: string;
  card: string;
  ink: string;
  inkSoft: string;
  line: string;
  jade: string;
  jadeSoft: string;
  onJade: string;
  clay: string;
  claySoft: string;
  gold: string;
};

export const palettes: Record<'light' | 'dark', Palette> = {
  light: {
    dark: false,
    paper: '#FBF6EC',
    paperDeep: '#F4EADA',
    card: '#FFFDF8',
    ink: '#221C14',
    inkSoft: '#6E6455',
    line: '#E4D8C4',
    jade: '#2F6B57',
    jadeSoft: '#DEEAE2',
    onJade: '#FCFAF4',
    clay: '#AC553D',
    claySoft: '#F5E3DB',
    gold: '#B9963F',
  },
  dark: {
    dark: true,
    paper: '#14120F',
    paperDeep: '#1F1C17',
    card: '#1A1713',
    ink: '#F2EADB',
    inkSoft: '#A79C8B',
    line: '#302A22',
    jade: '#6FB79A',
    jadeSoft: '#1C2B25',
    onJade: '#0E1912',
    clay: '#D98368',
    claySoft: '#33231C',
    gold: '#D8B665',
  },
};

export const radius = {
  card: 26,
  button: 18,
  pill: 999,
} as const;

export const spacing = (n: number) => n * 4;
