// agy-mux — auth

const AUTH_TOKEN = process.env.AUTH_TOKEN;

export function isDevMode() {
  return !AUTH_TOKEN;
}

export function verifyToken(token) {
  if (isDevMode()) return true;
  return token === AUTH_TOKEN;
}
