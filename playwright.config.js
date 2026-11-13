"use strict";
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "e2e",
  timeout: 30000,
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    // Uses the installed Microsoft Edge so no separate browser download is needed.
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
  },
  webServer: {
    command: "node e2e/server.js",
    url: "http://127.0.0.1:4173/index.html",
    reuseExistingServer: !process.env.CI,
  },
});
