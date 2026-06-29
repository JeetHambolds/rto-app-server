import { createHash, randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import {
  APP_USER_TYPE,
  JWT_ACCESS_EXPIRES_IN,
  JWT_SECRET,
} from "./config.js";

export function hashRefreshToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function generateRefreshToken() {
  return randomBytes(48).toString("base64url");
}

export function signAccessToken(user) {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured.");
  }

  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      userType: user.user_type ?? APP_USER_TYPE,
      isAdmin: user.is_admin,
    },
    JWT_SECRET,
    { expiresIn: JWT_ACCESS_EXPIRES_IN },
  );
}

export function verifyAccessToken(token) {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured.");
  }

  return jwt.verify(token, JWT_SECRET);
}
