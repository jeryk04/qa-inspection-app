// Deliberately loose (not RFC 5322) -- this field is an optional contact
// address, not a login credential or a delivery-critical address yet, so a
// simple shape check that catches typos is enough.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return EMAIL_RE.test(email);
}

module.exports = { isValidEmail };
