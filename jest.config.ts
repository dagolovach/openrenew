// jest.config.ts
import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  setupFiles: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/.worktrees/'],
  transformIgnorePatterns: ['/node_modules/(?!(jose)/)'],
  transform: {
    '^.+\\.(t|j)sx?$': 'ts-jest',
  },
}

export default config
