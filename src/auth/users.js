import bcrypt from "bcryptjs";
import { supabase } from "../supabase.js";
import {
  APP_USER_TYPE,
  BCRYPT_ROUNDS,
  REFRESH_TOKEN_TTL_MS,
} from "./config.js";
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from "./tokens.js";

function requireSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.",
    );
  }
}

export function toPublicUser(row) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    userType: row.user_type,
    isAdmin: row.is_admin,
    isApproved: row.is_approved,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
  };
}

export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

export async function findUserByEmail(email, userType = APP_USER_TYPE) {
  requireSupabase();

  const { data, error } = await supabase
    .from("app_users")
    .select("*")
    .eq("email", email.toLowerCase().trim())
    .eq("user_type", userType)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function findUserById(id) {
  requireSupabase();

  const { data, error } = await supabase
    .from("app_users")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function countUsers(userType = APP_USER_TYPE) {
  requireSupabase();

  const { count, error } = await supabase
    .from("app_users")
    .select("id", { count: "exact", head: true })
    .eq("user_type", userType);

  if (error) throw error;
  return count ?? 0;
}

export async function createUser({ name, email, password }) {
  requireSupabase();

  const normalizedEmail = email.toLowerCase().trim();
  const existingCount = await countUsers();
  const isFirstUser = existingCount === 0;

  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("app_users")
    .insert({
      name: name.trim(),
      email: normalizedEmail,
      password_hash: passwordHash,
      user_type: APP_USER_TYPE,
      is_admin: isFirstUser,
      is_approved: isFirstUser,
      approved_at: isFirstUser ? now : null,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw Object.assign(new Error("An account with this email already exists."), {
        status: 409,
      });
    }
    throw error;
  }

  return data;
}

export async function issueAuthTokens(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString();

  const { error } = await supabase.from("refresh_tokens").insert({
    user_id: user.id,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  if (error) throw error;

  return { accessToken, refreshToken };
}

export async function refreshAuthTokens(refreshToken) {
  requireSupabase();

  const tokenHash = hashRefreshToken(refreshToken);
  const now = new Date().toISOString();

  const { data: storedToken, error } = await supabase
    .from("refresh_tokens")
    .select("id, user_id, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) throw error;

  if (
    !storedToken ||
    storedToken.revoked_at ||
    storedToken.expires_at <= now
  ) {
    throw Object.assign(new Error("Invalid or expired refresh token."), {
      status: 401,
    });
  }

  const user = await findUserById(storedToken.user_id);
  if (!user || !user.is_approved) {
    throw Object.assign(new Error("Account is not approved."), { status: 403 });
  }

  const { error: revokeError } = await supabase
    .from("refresh_tokens")
    .update({ revoked_at: now })
    .eq("id", storedToken.id);

  if (revokeError) throw revokeError;

  return issueAuthTokens(user);
}

export async function revokeRefreshToken(refreshToken) {
  requireSupabase();

  const tokenHash = hashRefreshToken(refreshToken);
  const { error } = await supabase
    .from("refresh_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", tokenHash)
    .is("revoked_at", null);

  if (error) throw error;
}

export async function listUsers(userType = APP_USER_TYPE) {
  requireSupabase();

  const { data, error } = await supabase
    .from("app_users")
    .select(
      "id, name, email, user_type, is_admin, is_approved, approved_at, created_at",
    )
    .eq("user_type", userType)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data.map(toPublicUser);
}

export async function setUserApproval(userId, isApproved, approvedBy) {
  requireSupabase();

  const { data, error } = await supabase
    .from("app_users")
    .update({
      is_approved: isApproved,
      approved_at: isApproved ? new Date().toISOString() : null,
      approved_by: isApproved ? approvedBy : null,
    })
    .eq("id", userId)
    .eq("user_type", APP_USER_TYPE)
    .select(
      "id, name, email, user_type, is_admin, is_approved, approved_at, created_at",
    )
    .single();

  if (error) throw error;
  return toPublicUser(data);
}
