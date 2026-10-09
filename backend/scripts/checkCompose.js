import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

// Resolve only synthetic variables; never read or print deployment env files.
const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = { DATABASE_URL: "mongodb+srv://fixture.invalid/medipulse_prod", TOKEN_KEY: "synthetic-compose-fixture-signing-key",
  CLIENT_URLS: "https://medipulse.live", PUBLIC_API_URL: "https://api.example.invalid" };
const directory = mkdtempSync(join(tmpdir(), "medipulse-compose-"));
try {
  const envFile = join(directory, "fixture.env");
  writeFileSync(envFile, Object.entries(fixture).map(([key, value]) => `${key}=${value}`).join("\n"));
  for (const production of [false, true]) {
    const args = ["compose", "--env-file", envFile, "-f", "docker-compose.yml",
      ...(production ? ["-f", "docker-compose.prod.yml"] : []), "config", "--no-env-resolution", "--format", "json"];
    const { services } = JSON.parse(execFileSync("docker", args, { cwd: root, env: { ...process.env, ...fixture },
      encoding: "utf8", timeout: 90000, stdio: ["ignore", "pipe", "pipe"] }));
    const api = services.backend, worker = services["vpay-consumer"];
    assert.equal(api.environment.DATABASE_URL, worker.environment.DATABASE_URL);
    assert.equal(api.environment.REDIS_URL, worker.environment.REDIS_URL);
    assert.equal(api.environment.USE_REAL_REDIS, "true");
    if (production) {
      assert.equal(api.environment.DATABASE_URL, fixture.DATABASE_URL);
      assert.equal(api.environment.NODE_ENV, "production");
      assert.ok(!services.mongo && !services["mongo-init"] && !services["queue-init"] && !api.depends_on["mongo-init"] && !api.depends_on["queue-init"]);
      assert.ok(!services.redis.ports?.length && !services.kafka.ports?.length);
    } else {
      assert.match(api.environment.DATABASE_URL, /\/medipulse_dev\?/);
      assert.equal(api.depends_on["mongo-init"].condition, "service_completed_successfully");
      assert.equal(api.depends_on["queue-init"].condition, "service_completed_successfully");
    }
    console.log(`${production ? "Production" : "Local"} Compose: database, Redis and dependency checks passed`);
  }
} catch {
  console.error("Compose validation failed. Check Docker Compose 2.24.4+ and the stack configuration.");
  process.exitCode = 1;
} finally { rmSync(directory, { recursive: true, force: true }); }
