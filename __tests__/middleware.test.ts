// __tests__/middleware.test.ts
import { updateSession } from '@/lib/supabase/middleware'

// Smoke test: verifies the module exports a callable function.
// Route-level redirect logic is covered by integration tests.
describe('updateSession', () => {
  it('is a function that accepts a NextRequest', () => {
    expect(typeof updateSession).toBe('function')
  })
})
