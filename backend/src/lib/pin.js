// All users (Operator through Admin) sign in with a 4-digit numeric PIN --
// no separate "password" concept. Kept as a shared constant/helper so the
// length lives in one place (auth.js's self-service change, admin.js's
// create/reset).
const PIN_LENGTH = 4;
const PIN_PATTERN = new RegExp(`^\\d{${PIN_LENGTH}}$`);

function isValidPin(value) {
  return typeof value === "string" && PIN_PATTERN.test(value);
}

module.exports = { PIN_LENGTH, isValidPin };
