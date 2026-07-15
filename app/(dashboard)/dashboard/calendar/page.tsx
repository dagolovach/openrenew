// app/(dashboard)/dashboard/calendar/page.tsx
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { isExpired } from '@/lib/utils';
import RenewalCalendar from '@/components/calendar/RenewalCalendar';
import DashboardNav from '@/components/dashboard/dashboard-nav';
import '../dashboard.css';

export const metadata = { title: 'Renewal Calendar — OpenRenew' };
export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: contracts } = await supabase
    .from('contracts')
    .select(`
      id, name, party_a, category,
      expiry_date, renewal_date, auto_renew,
      notice_period_days, contract_value, status
    `)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('expiry_date', { ascending: true });

  const active = (contracts ?? []).filter(c => !isExpired(c));

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
