import type { Config } from '../types';

export const API_URL = process.env.EXPO_PUBLIC_API_URL?.trim() || 'https://server-riga.tailf358cb.ts.net:10000';
const TOKEN = process.env.EXPO_PUBLIC_API_TOKEN?.trim() ?? '';

export function loadConfig(): Config {
  return { token: TOKEN };
}
