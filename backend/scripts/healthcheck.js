const port = process.argv[2] === "consumer" ? (process.env.CONSUMER_HEALTH_PORT || 8082) : (process.env.PORT || 8080);
try {
  const response = await fetch(`http://127.0.0.1:${port}/health/ready`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) process.exitCode = 1;
} catch { process.exitCode = 1; }
