const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  console.warn(
    "WARNING: JWT_SECRET is not set in the environment. Using an insecure dev-only default — " +
      "set JWT_SECRET in backend/.env before using this outside local development."
  );
}

const EFFECTIVE_SECRET = SECRET || "dev-only-insecure-secret-change-me";
const COOKIE_NAME = "qa_session";

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, full_name: user.full_name },
    EFFECTIVE_SECRET,
    { expiresIn: "12h" }
  );
}

function verifyToken(token) {
  return jwt.verify(token, EFFECTIVE_SECRET);
}

module.exports = { signToken, verifyToken, COOKIE_NAME };
