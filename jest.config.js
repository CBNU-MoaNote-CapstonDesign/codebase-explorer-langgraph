export default {
  testEnvironment: "node",
  roots: ["<rootDir>/__tests__"],
  extensionsToTreatAsESM: [".js"],
  transform: {},
  setupFiles: ["<rootDir>/test-setups/setup-env.js"],
  setupFilesAfterEnv: ["<rootDir>/test-setups/setup-timeout.js"]
};