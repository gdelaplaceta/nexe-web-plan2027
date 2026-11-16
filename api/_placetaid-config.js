const DEFAULT_REDIRECT_URI = 'https://nexe.laplaceta.org/auth/callback';

export function placetaidRedirectUri() {
  return process.env.PLACETAID_REDIRECT_URI || DEFAULT_REDIRECT_URI;
}
