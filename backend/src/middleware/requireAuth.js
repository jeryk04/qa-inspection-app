const { verifyToken, COOKIE_NAME } = require("../lib/jwt");

function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, username: payload.username, full_name: payload.full_name };
    next();
  } catch {
    res.status(401).json({ error: "Not authenticated" });
  }
}

module.exports = requireAuth;
