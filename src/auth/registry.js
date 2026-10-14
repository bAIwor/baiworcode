/**
 * Registry Provider OAuth & Endpoint
 * Format mudah diperluas dan disesuaikan.
 */

export const PROVIDERS = {
  'github-copilot': {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    desc: 'GitHub Device OAuth',
    method: 'device',
    deviceEndpoint: 'https://github.com/login/device/code',
    tokenEndpoint: 'https://github.com/login/oauth/access_token',
    scope: 'read:user',
    getClientId: (config) =>
      process.env.BAIWOR_COPILOT_CLIENT_ID ||
      config?.oauth?.['github-copilot']?.clientId ||
      '',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'claude-3.5-sonnet', 'o1-mini', 'o1-preview'],
    setupGuide:
      'Daftarkan OAuth App dengan Device Flow di https://github.com/settings/developers atau atur BAIWOR_COPILOT_CLIENT_ID.',
    baseUrl: 'https://api.githubcopilot.com',
  },
  'google-gemini': {
    id: 'google-gemini',
    name: 'Google Gemini',
    desc: 'Google Account OAuth / Gemini CLI',
    method: 'pkce',
    authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/generative-language',
    getClientId: (config) =>
      process.env.BAIWOR_GEMINI_CLIENT_ID ||
      config?.oauth?.['google-gemini']?.clientId ||
      '',
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    setupGuide:
      'Buat OAuth 2.0 Client ID (Desktop App) di Google Cloud Console (https://console.cloud.google.com/apis/credentials) atau atur BAIWOR_GEMINI_CLIENT_ID.',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  'openai': {
    id: 'openai',
    name: 'OpenAI',
    desc: 'ChatGPT / Codex Subscription OAuth',
    method: 'pkce',
    authEndpoint: 'https://auth.openai.com/authorize',
    tokenEndpoint: 'https://auth.openai.com/oauth/token',
    scope: 'openid profile email model.request',
    getClientId: (config) =>
      process.env.BAIWOR_OPENAI_CLIENT_ID ||
      config?.oauth?.['openai']?.clientId ||
      '',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o3-mini'],
    setupGuide:
      'Gunakan OpenAI OAuth App atau atur BAIWOR_OPENAI_CLIENT_ID. Tersedia juga opsi fallback API Key.',
    baseUrl: 'https://api.openai.com/v1',
  },
  'qwen': {
    id: 'qwen',
    name: 'Qwen',
    desc: 'Qwen Cloud CLI OAuth',
    method: 'device',
    deviceEndpoint: 'https://auth.alibabacloud.com/device/code',
    tokenEndpoint: 'https://auth.alibabacloud.com/oauth/token',
    scope: 'model:inference',
    getClientId: (config) =>
      process.env.BAIWOR_QWEN_CLIENT_ID ||
      config?.oauth?.['qwen']?.clientId ||
      '',
    defaultModel: 'qwen-max',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
    setupGuide:
      'Daftarkan OAuth Client di Alibaba Cloud DashScope Console atau atur BAIWOR_QWEN_CLIENT_ID.',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  'minimax': {
    id: 'minimax',
    name: 'MiniMax',
    desc: 'OAuth Coding Plan',
    method: 'device',
    deviceEndpoint: 'https://api.minimax.chat/oauth/device/code',
    tokenEndpoint: 'https://api.minimax.chat/oauth/token',
    scope: 'coding_plan',
    getClientId: (config) =>
      process.env.BAIWOR_MINIMAX_CLIENT_ID ||
      config?.oauth?.['minimax']?.clientId ||
      '',
    defaultModel: 'MiniMax-Text-01',
    models: ['MiniMax-Text-01', 'abab6.5s-chat'],
    setupGuide:
      'Daftarkan OAuth App di MiniMax Developer Portal atau atur BAIWOR_MINIMAX_CLIENT_ID.',
    baseUrl: 'https://api.minimax.chat/v1',
  },
};
