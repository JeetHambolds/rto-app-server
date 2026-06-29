import { Router } from "express";
import { requireAdmin, requireAuth } from "./middleware.js";
import {
  createUser,
  findUserByEmail,
  issueAuthTokens,
  listUsers,
  refreshAuthTokens,
  revokeRefreshToken,
  setUserApproval,
  toPublicUser,
  verifyPassword,
} from "./users.js";

const router = Router();

router.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({
        error: "Name, email, and password are required.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: "Password must be at least 6 characters.",
      });
    }

    const user = await createUser({ name, email, password });

    if (user.is_approved) {
      const tokens = await issueAuthTokens(user);
      return res.status(201).json({
        user: toPublicUser(user),
        ...tokens,
      });
    }

    res.status(201).json({
      user: toPublicUser(user),
      message: "Account created. An admin must approve your account before you can sign in.",
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email?.trim() || !password) {
      return res.status(400).json({
        error: "Email and password are required.",
      });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    if (!user.is_approved) {
      return res.status(403).json({
        error: "Your account is pending admin approval.",
        user: toPublicUser(user),
      });
    }

    const tokens = await issueAuthTokens(user);

    res.json({
      user: toPublicUser(user),
      ...tokens,
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.post("/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: "refreshToken is required." });
    }

    const tokens = await refreshAuthTokens(refreshToken);
    res.json(tokens);
  } catch (err) {
    console.error(err);
    res.status(err.status || 401).json({ error: err.message });
  }
});

router.post("/logout", async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.auth.profile });
});

router.get("/admin/users", requireAdmin, async (_req, res) => {
  try {
    const users = await listUsers();
    res.json({ users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to fetch users." });
  }
});

router.patch("/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    const { isApproved } = req.body;
    if (typeof isApproved !== "boolean") {
      return res.status(400).json({ error: "isApproved must be a boolean." });
    }

    const user = await setUserApproval(
      req.params.id,
      isApproved,
      req.auth.user.id,
    );

    res.json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to update user." });
  }
});

export default router;
