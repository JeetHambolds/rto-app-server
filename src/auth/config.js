export const APP_USER_TYPE = "RTO";

export const JWT_SECRET = process.env.JWT_SECRET;
export const JWT_ACCESS_EXPIRES_IN =
  process.env.JWT_ACCESS_EXPIRES_IN || "15m";

export const REFRESH_TOKEN_TTL_MS =
  Number(process.env.REFRESH_TOKEN_TTL_MS) || 7 * 24 * 60 * 60 * 1000;

export const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 12;
