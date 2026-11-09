import { defineConfig, devices } from "@playwright/test";

// Smoke tests against a production build. Needs `npm run build` first.
export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3100", locale: "en-GB", timezoneId: "Europe/London" },
  webServer: {
    command: "npm run start -- -p 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: !process.env.CI,
    // With the local test stack, emails go to a pretend email service run by the signed-in tests.
    env: process.env.E2E_DB_URL
      ? { RESEND_API_URL: "http://127.0.0.1:3998", RESEND_API_KEY: "test-key", EMAIL_FROM: "Burwain Test <club@example.test>" }
      : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
