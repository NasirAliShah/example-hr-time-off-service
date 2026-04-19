module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.e2e-spec.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  globalSetup: '<rootDir>/test/global-e2e-setup.ts',
  globalTeardown: '<rootDir>/test/global-e2e-teardown.ts',
  maxWorkers: 1,
  forceExit: true,
  detectOpenHandles: true,
};
