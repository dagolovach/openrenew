import { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.APP_URL || 'http://localhost:3000'

  return [
    {
      url: baseUrl,
      lastModified: new Date('2026-03-20'),
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/faq`,
      lastModified: new Date('2026-02-15'),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/resources`,
      lastModified: new Date('2026-02-10'),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/resources/contract-renewal-tracker-template`,
      lastModified: new Date('2026-02-01'),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/resources/saas-renewal-tracker`,
      lastModified: new Date('2026-02-01'),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/resources/saas-audit-checklist`,
      lastModified: new Date('2026-02-01'),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/resources/vendor-notice-period-guide`,
      lastModified: new Date('2026-02-01'),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/resources/renewl-vs-spreadsheet`,
      lastModified: new Date('2026-02-10'),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/resources/renewal-leak-calculator`,
      lastModified: new Date('2026-03-30'),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/blog`,
      lastModified: new Date('2026-03-24'),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/blog/ai-contract-risk-analysis`,
      lastModified: new Date('2026-03-24'),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/blog/auto-renewal-clauses`,
      lastModified: new Date('2026-02-20'),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/blog/cost-of-forgotten-renewals`,
      lastModified: new Date('2026-02-20'),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/blog/vendor-notice-period-guide`,
      lastModified: new Date('2026-02-20'),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/blog/renewl-vs-spreadsheet`,
      lastModified: new Date('2026-02-20'),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
  ]
}
