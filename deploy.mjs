import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import https from "https";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const email = "25r21a67h4@mlrit.ac.in";
const password = "Sakethisinmlrit@2";
const domain = "smart-trip-budgeting.surge.sh";
const distPath = path.join(__dirname, "dist");
const surgeBin = path.join(__dirname, "node_modules", "surge", "bin", "surge");

// Get surge token via API
const getToken = () => new Promise((resolve, reject) => {
  const body = JSON.stringify({ email, password });
  const req = https.request({
    hostname: "surge.surge.sh", path: "/token", method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
  }, res => {
    let data = "";
    res.on("data", d => data += d);
    res.on("end", () => {
      console.log("Token API status:", res.statusCode, "body:", data);
      try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); }
    });
  });
  req.on("error", reject);
  req.write(body); req.end();
});

const result = await getToken();
console.log("Token result:", JSON.stringify(result));

const token = result.token || result.surge_token || result.access_token;
if (!token) { console.log("Could not get token. Trying with password as token..."); }

const useToken = token || password;
const cmd = `"${process.execPath}" "${surgeBin}" --project "${distPath}" --domain ${domain}`;
console.log("Deploying...");
try {
  const out = execSync(cmd, {
    encoding: "utf8", timeout: 60000,
    env: { ...process.env, SURGE_LOGIN: email, SURGE_TOKEN: useToken }
  });
  console.log(out);
} catch(e) {
  console.log("stdout:", e.stdout);
  console.log("stderr:", e.stderr);
}
