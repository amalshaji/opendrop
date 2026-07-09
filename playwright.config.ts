import { defineConfig, devices } from "@playwright/test";

const serverPort = process.env.OPENDROP_E2E_SERVER_PORT || "43300";
const serverUrl = process.env.OPENDROP_E2E_SERVER_URL || `http://127.0.0.1:${serverPort}`;
const shouldStartCompose = process.env.OPENDROP_E2E_SERVER_URL === undefined && process.env.OPENDROP_E2E_SKIP_WEB_SERVER !== "true";
const shouldRunFullBrowserMatrix = process.env.OPENDROP_E2E_BROWSER_MATRIX === "full";

const matrixProjects = [
  {
    name: "mobile-chromium-smoke",
    testMatch: /matrix\.spec\.ts/,
    use: { ...devices["Pixel 7"] }
  },
  ...(shouldRunFullBrowserMatrix
    ? [
        {
          name: "firefox-smoke",
          testMatch: /matrix\.spec\.ts/,
          use: { ...devices["Desktop Firefox"] }
        },
        {
          name: "webkit-smoke",
          testMatch: /matrix\.spec\.ts/,
          use: { ...devices["Desktop Safari"] }
        },
        {
          name: "mobile-safari-smoke",
          testMatch: /matrix\.spec\.ts/,
          use: { ...devices["iPhone 15"] }
        }
      ]
    : [])
];

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: {
    baseURL: serverUrl,
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "cli",
      testMatch: /cli\.spec\.ts/
    },
    {
      name: "chromium-ui",
      testMatch: /ui\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] }
    },
    ...matrixProjects
  ],
  webServer: shouldStartCompose
    ? {
        command: "docker compose -f docker-compose.e2e.yml up --build app",
        url: `${serverUrl}/healthz`,
        reuseExistingServer: false,
        timeout: 120_000
      }
    : undefined
});
