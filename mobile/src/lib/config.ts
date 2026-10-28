import type { Config } from '../types';

export const API_URL = process.env.EXPO_PUBLIC_API_URL?.trim() || 'http://localhost:8787';
const TOKEN = process.env.EXPO_PUBLIC_API_TOKEN?.trim() ?? '';

export function loadConfig(): Config {
  return { token: TOKEN };
}
