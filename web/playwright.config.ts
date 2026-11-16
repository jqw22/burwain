import { defineConfig, devices } from "@playwright/test";

const EMAIL_ENV = { RESEND_API_URL: "http://127.0.0.1:3998", RESEND_API_KEY: "test-key", EMAIL_FROM: "Burwain Test <club@example.test>" };

// Smoke tests against a production build. Needs `npm run build` first.
export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:3100",
    locale: "en-GB",
    timezoneId: "Europe/London",
    // Start the browser in UK English so date boxes show dd/mm/yyyy, as members' UK browsers do.
    launchOptions: { args: ["--lang=en-GB"], env: { ...process.env, LANG: "en_GB.UTF-8", LANGUAGE: "en_GB" } },
  },
  webServer: [
    {
      command: "npm run start -- -p 3100",
      url: "http://localhost:3100/login",
      reuseExistingServer: !process.env.CI,
      // With the local test stack, emails go to a pretend email service run by the signed-in tests.
      env: process.env.E2E_DB_URL ? EMAIL_ENV : {},
    },
    // A second copy with card payments switched on, talking to a pretend Stripe run by card-payments.spec.ts.
    ...(process.env.E2E_DB_URL && process.env.E2E_SUPABASE_SECRET_KEY
      ? [
          {
            command: "npm run start -- -p 3101",
            url: "http://localhost:3101/login",
            reuseExistingServer: !process.env.CI,
            env: {
              ...EMAIL_ENV,
              RESEND_API_URL: "http://127.0.0.1:3996", // its own pretend email service, in card-payments.spec.ts
              STRIPE_SECRET_KEY: "sk_test_e2e",
              STRIPE_WEBHOOK_SECRET: "whsec_e2e",
              STRIPE_API_URL: "http://127.0.0.1:3997",
              SUPABASE_SECRET_KEY: process.env.E2E_SUPABASE_SECRET_KEY,
            },
          },
        ]
      : []),
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
