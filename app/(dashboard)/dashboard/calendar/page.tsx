import { redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contracts } from '@/lib/db/schema';
import { getSessionUser } from '@/lib/auth/session';
import { isExpired } from '@/lib/utils';
import RenewalCalendar from '@/components/calendar/RenewalCalendar';
import DashboardNav from '@/components/dashboard/dashboard-nav';
import '../dashboard.css';

export const metadata = { title: 'Renewal Calendar' };
export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const rows = await db.query.contracts.findMany({
    where: eq(contracts.status, 'active'),
    orderBy: asc(contracts.expiryDate),
    columns: {
      id: true,
      name: true,
      partyA: true,
      category: true,
      expiryDate: true,
      renewalDate: true,
      autoRenew: true,
      noticePeriodDays: true,
      contractValue: true,
      status: true,
    },
  });

  const mapped = rows.map((c) => ({
    id: c.id,
    name: c.name,
    party_a: c.partyA,
    category: c.category,
    expiry_date: c.expiryDate,
    renewal_date: c.renewalDate,
    auto_renew: c.autoRenew,
    notice_period_days: c.noticePeriodDays,
    contract_value: c.contractValue,
    status: c.status,
  }));

  const active = mapped.filter(c => !isExpired(c));

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      fontFamily: 'var(--font-inter), system-ui, sans-serif',
      color: '#F9FAFB',
    }}>
      <DashboardNav userEmail={user.email ?? ''} />
      <main style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        padding: '20px 24px 16px',
        maxWidth: '1200px',
        width: '100%',
        margin: '0 auto',
        boxSizing: 'border-box',
      }}>
        <RenewalCalendar contracts={active} />
      </main>
    </div>
  );
}
