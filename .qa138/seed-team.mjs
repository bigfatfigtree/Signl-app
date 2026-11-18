import fs from "node:fs";
import crypto from "node:crypto";
const path = new URL("./db-qa.json", import.meta.url).pathname;
const db = JSON.parse(fs.readFileSync(path, "utf8"));
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("<MASKED_SECRET_001>", salt, 64).toString("hex");
db["user:tmqa138"] = {
  id: "tmqa138", role: "admin", status: "approved", name: "Tess Teammate", email: "tm@qa138.dev",
  passwordSalt: salt, passwordHash: hash, tester: false, createdAt: new Date().toISOString(),
  adminPerms: { super: false, flags: { approvals: true, "creators.view": true, outreach: true }, markets: ["Nashville"], statScopes: [], template: "outreach_rep", grantedBy: "seed", grantedAt: new Date().toISOString() },
};
db["email:tm@qa138.dev"] = { userId: "tmqa138" };
fs.writeFileSync(path, JSON.stringify(db));
console.log("teammate seeded");
