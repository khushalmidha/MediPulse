import { readFileSync, existsSync } from "node:fs";
import { parse } from "dotenv";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { localTestTargets } from "../util/testTargets.js";

try {
  const file = fileURLToPath(new URL("../.env.local", import.meta.url));
  const local = existsSync(file) ? parse(readFileSync(file)) : {};
  const target = localTestTargets({ TEST_DATABASE_URL: process.env.TEST_DATABASE_URL || local.TEST_DATABASE_URL,
    TEST_REDIS_URL: process.env.TEST_REDIS_URL || local.TEST_REDIS_URL });
  const child = spawn(process.execPath, ["--import", new URL("../tests/bootstrap.js", import.meta.url).href,
    "--test", "--test-concurrency=1", fileURLToPath(new URL("../tests/integration/local-stack.test.js", import.meta.url)),
    fileURLToPath(new URL("../tests/integration/p03-queues.test.js", import.meta.url)),
    fileURLToPath(new URL("../tests/integration/p04-money.test.js", import.meta.url)),
    fileURLToPath(new URL("../tests/integration/p05-sessions.test.js", import.meta.url)),
    fileURLToPath(new URL("../tests/integration/p06-workflows.test.js", import.meta.url)),
    fileURLToPath(new URL("../tests/integration/p07-products.test.js", import.meta.url))], {
    stdio: "inherit", env: { ...process.env, TEST_DATABASE_URL: target.mongo, TEST_REDIS_URL: target.redis },
  });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
  child.on("error", () => { console.error("Unable to start isolated integration tests"); process.exitCode = 1; });
} catch (error) { console.error(error.message); process.exitCode = 1; }
