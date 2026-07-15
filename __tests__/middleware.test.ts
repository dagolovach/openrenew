// __tests__/middleware.test.ts
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'
import { signSessionToken, SESSION_COOKIE } from '@/lib/auth/session'

describe('proxy', () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = 'test-secret-at-least-32-chars-long!!'
  })

  afterEach(() => {
    delete process.env.AUTH_DISABLED
  })

  it('redirects unauthenticated /dashboard to /login', async () => {
    const request = new NextRequest(new URL('http://localhost:3000/dashboard'))
    const res = await proxy(request)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3000/login')
  })

  it('redirects authenticated /login to /dashboard', async () => {
    const token = await signSessionToken('11111111-1111-1111-1111-111111111111')
    const request = new NextRequest(new URL('http://localhost:3000/login'))
    request.cookies.set(SESSION_COOKIE, token)
    const res = await proxy(request)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3000/dashboard')
  })

  it('redirects / to /dashboard when authenticated', async () => {
    const token = await signSessionToken('11111111-1111-1111-1111-111111111111')
    const request = new NextRequest(new URL('http://localhost:3000/'))
    request.cookies.set(SESSION_COOKIE, token)
    const res = await proxy(request)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3000/dashboard')
  })

  it('redirects / to /login when unauthenticated', async () => {
    const request = new NextRequest(new URL('http://localhost:3000/'))
    const res = await proxy(request)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3000/login')
  })

  it('passes through /dashboard without a cookie when AUTH_DISABLED=true', async () => {
    process.env.AUTH_DISABLED = 'true'
    const request = new NextRequest(new URL('http://localhost:3000/dashboard'))
    const res = await proxy(request)
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })

  it('redirects /dashboard to /login when the token is tampered with', async () => {
    const token = await signSessionToken('11111111-1111-1111-1111-111111111111')
    const request = new NextRequest(new URL('http://localhost:3000/dashboard'))
    request.cookies.set(SESSION_COOKIE, token + 'x')
    const res = await proxy(request)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3000/login')
  })
})
