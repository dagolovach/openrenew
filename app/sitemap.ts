import { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  // No public marketing routes remain (app/(marketing) was removed) and there
  // is no root page — the app is dashboard-only. Nothing to list here yet.
  return []
}
