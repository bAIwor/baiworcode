/**
 * Registry Provider OAuth & Endpoint
 * Disederhanakan untuk bAIwor Code: Google Gemini (OAuth) dan Agentik / Custom Endpoint.
 */

export const PROVIDERS = {
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
};

