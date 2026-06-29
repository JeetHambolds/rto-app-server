import { verifyAccessToken } from "./tokens.js";
import { findUserById, toPublicUser } from "./users.js";

function getBearerToken(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7);
}

export async function authenticateRequest(req) {
  const token = getBearerToken(req);
  if (!token) {
    throw Object.assign(new Error("Authentication required."), { status: 401 });
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw Object.assign(new Error("Invalid or expired access token."), {
      status: 401,
    });
  }

  const user = await findUserById(payload.sub);
  if (!user) {
    throw Object.assign(new Error("User not found."), { status: 401 });
  }

  if (!user.is_approved) {
    throw Object.assign(new Error("Your account is pending admin approval."), {
      status: 403,
    });
  }

  return {
    user,
    profile: toPublicUser(user),
    accessToken: token,
  };
}

export function requireAuth(req, res, next) {
  authenticateRequest(req)
    .then((auth) => {
      req.auth = auth;
      next();
    })
    .catch((err) => {
      res.status(err.status || 401).json({ error: err.message });
    });
}

export function requireAdmin(req, res, next) {
  authenticateRequest(req)
    .then((auth) => {
      if (!auth.user.is_admin) {
        return res.status(403).json({ error: "Admin access required." });
      }
      req.auth = auth;
      next();
    })
    .catch((err) => {
      res.status(err.status || 401).json({ error: err.message });
    });
}
