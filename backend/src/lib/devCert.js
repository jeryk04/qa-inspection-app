const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const selfsigned = require("selfsigned");

const CERT_DIR = path.join(__dirname, "..", "..", "certs");
const KEY_PATH = path.join(CERT_DIR, "dev-key.pem");
const CERT_PATH = path.join(CERT_DIR, "dev-cert.pem");

// Every private (non-internal) IPv4 address on this machine -- so the
// cert is valid no matter which NIC (Ethernet, Wi-Fi, ...) a tablet ends up
// reaching this box through, not just whichever one was active when the
// cert was first generated.
function lanIps() {
  const ips = [];
  Object.values(os.networkInterfaces()).forEach((entries) => {
    (entries || []).forEach((entry) => {
      if (entry.family === "IPv4" && !entry.internal) ips.push(entry.address);
    });
  });
  return ips;
}

// Self-signed dev cert, cached to disk and regenerated only when the set of
// LAN IPs it needs to cover has changed (e.g. this machine got a new IP) --
// a tablet still has to click through the browser's "not secure" warning
// once per cert, so keeping the same cert across restarts avoids making
// them do that every time the dev server restarts.
async function getOrCreateDevCert() {
  const altNames = [
    { type: 2, value: "localhost" },
    { type: 7, ip: "127.0.0.1" },
    ...lanIps().map((ip) => ({ type: 7, ip })),
  ];

  if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
    const cert = fs.readFileSync(CERT_PATH, "utf8");
    // The PEM itself is base64, so the SAN entries have to be read from the
    // parsed cert -- e.g. "DNS:localhost, IP Address:127.0.0.1".
    let sans = [];
    try {
      sans = (new crypto.X509Certificate(cert).subjectAltName || "").split(", ");
    } catch {
      // unreadable cert -- fall through and regenerate
    }
    const coversAll = altNames.every((n) =>
      sans.includes(n.ip ? `IP Address:${n.ip}` : `DNS:${n.value}`)
    );
    if (coversAll) {
      return { key: fs.readFileSync(KEY_PATH, "utf8"), cert };
    }
  }

  const pems = await selfsigned.generate([{ name: "commonName", value: "localhost" }], {
    days: 3650,
    keySize: 2048,
    extensions: [{ name: "subjectAltName", altNames }],
  });

  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(KEY_PATH, pems.private);
  fs.writeFileSync(CERT_PATH, pems.cert);

  return { key: pems.private, cert: pems.cert };
}

module.exports = { getOrCreateDevCert };
