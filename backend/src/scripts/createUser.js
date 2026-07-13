// Usage: node src/scripts/createUser.js <username> <password> <full name>
const bcrypt = require("bcryptjs");
const db = require("../db");

const [username, password, ...nameParts] = process.argv.slice(2);
const fullName = nameParts.join(" ");

if (!username || !password || !fullName) {
  console.error("Usage: node src/scripts/createUser.js <username> <password> <full name>");
  process.exit(1);
}

const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
if (existing) {
  console.error(`User "${username}" already exists.`);
  process.exit(1);
}

const passwordHash = bcrypt.hashSync(password, 10);
const result = db
  .prepare("INSERT INTO users (username, password_hash, full_name) VALUES (?, ?, ?)")
  .run(username, passwordHash, fullName);

console.log(`Created user "${username}" (id ${result.lastInsertRowid}, full name "${fullName}").`);
