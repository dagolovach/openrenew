// proxy.ts
import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Landing page: redirect logged-in users to dashboard via cookie check only.
  // No Supabase DB call — keeps the landing page statically renderable for anonymous visitors.
  if (pathname === '/') {
    const hasAuthCookie = request.cookies.getAll().some(
      (c) => c.name.includes('auth-token') && c.name.startsWith('sb-')
    )
    if (hasAuthCookie) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
    return NextResponse.next()
  }

  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - api/ routes (they manage their own auth)
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - image files (svg, png, jpg, jpeg, gif, webp)
     */
    '/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
