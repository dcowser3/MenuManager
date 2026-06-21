module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Runs before any module loads in each test file: forces all mail transports
  // off so the suite can never send real email. See jest.setup.js.
  setupFiles: ['<rootDir>/jest.setup.js'],
  roots: ['<rootDir>/services'],
  testMatch: [
    '**/__tests__/**/*.(ts|tsx|js)',
    '**/?(*.)+(spec|test).(ts|tsx|js)',
  ],
  // Only run the TypeScript/JS source tests. `tsc` (via the build) emits
  // compiled duplicates into each service's dist/, which would otherwise be
  // matched and run with broken relative-mock resolution.
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
};
