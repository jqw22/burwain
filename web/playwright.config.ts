import { defineConfig, devices } from "@playwright/test";

// Smoke tests against a production build. Needs `npm run build` first.
export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3100" },
  webServer: {
    command: "npm run start -- -p 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
