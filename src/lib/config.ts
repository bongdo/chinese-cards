import type { Config } from '../types';

const PRIMARY = process.env.EXPO_PUBLIC_API_URL?.trim() || 'https://server-riga.tailf358cb.ts.net:10000';
const TOKEN = process.env.EXPO_PUBLIC_API_TOKEN?.trim() ?? '';

export const baseUrls = [PRIMARY];

export function loadConfig(): Config {
  return { baseUrl: PRIMARY, token: TOKEN };
}
