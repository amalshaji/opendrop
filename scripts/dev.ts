const env = {
  ...process.env,
  OPENDROP_WEB_DEV_URL: process.env.OPENDROP_WEB_DEV_URL || "http://localhost:5173",
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || "opendrop-dev-secret-change-before-production"
};

const processes = [
  Bun.spawn(["bun", "run", "--cwd", "apps/server", "dev"], { env, stdout: "inherit", stderr: "inherit" }),
  Bun.spawn(["bun", "run", "--cwd", "apps/web", "dev"], { env, stdout: "inherit", stderr: "inherit" })
];

function stop() {
  for (const child of processes) child.kill();
}

process.on("SIGINT", () => {
  stop();
  process.exit(130);
});

process.on("SIGTERM", () => {
  stop();
  process.exit(143);
});

await Promise.race(processes.map((child) => child.exited));
stop();
