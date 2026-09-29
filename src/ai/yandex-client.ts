import OpenAI from 'openai';

let singleton: OpenAI | undefined;
export function getYandexClient(): OpenAI | null {
  const apiKey = process.env.YANDEX_CLOUD_API_TOKEN?.trim() || process.env.YANDEX_CLOUD_API_KEY?.trim();
  const folder = process.env.YANDEX_CLOUD_FOLDER_ID?.trim();
  if (!apiKey || !folder) return null;
  singleton ??= new OpenAI({ apiKey, baseURL: 'https://ai.api.cloud.yandex.net/v1',
    project: folder, defaultHeaders: { 'OpenAI-Project': folder }, maxRetries: 0, timeout: 10000 });
  return singleton;
}
export const modelUri = () => `gpt://${process.env.YANDEX_CLOUD_FOLDER_ID?.trim()}/${process.env.YANDEX_CLOUD_MODEL?.trim() || 'deepseek-v4-flash/latest'}`;
