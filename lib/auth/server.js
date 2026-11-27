import { createNeonAuth } from '@neondatabase/auth/next/server';
let instance;
export function getAuth() {
  if (!instance) {
    if (!process.env.NEON_AUTH_BASE_URL || !process.env.NEON_AUTH_COOKIE_SECRET) throw new Error('Neon Auth is not configured');
    instance = createNeonAuth({
      baseUrl: process.env.NEON_AUTH_BASE_URL,
      cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET }
    });
  }
  return instance;
}
