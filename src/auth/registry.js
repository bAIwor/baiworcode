export const PROVIDERS = {
  'google-gemini': {
    id: 'google-gemini',
    name: 'Google Gemini',
    desc: 'Login Google OAuth 2.0 PKCE via browser',
    method: 'pkce',
    authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    redirectPath: '/oauth2callback',
    scope:
      'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid',
    getClientId: (config) =>
      process.env.BAIWOR_GEMINI_CLIENT_ID ||
      config?.oauth?.['google-gemini']?.clientId ||
      '',
    getClientSecret: (config) =>
      process.env.BAIWOR_GEMINI_CLIENT_SECRET ||
      config?.oauth?.['google-gemini']?.clientSecret ||
      '',
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    setupGuide:
      'Login otomatis via akun Google di browser didukung via OAuth PKCE.\n     Bisa juga menggunakan API Key dari https://aistudio.google.com/apikey.',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
};

