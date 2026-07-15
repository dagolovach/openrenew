'use client';

import { useState, useMemo, useCallback, memo } from 'react';
import Link from 'next/link';

interface Contract {
  id: string;
  name: string;
  party_a: string | null;
  category: string | null;
  expiry_date: string | null;
  renewal_date: string | null;
  auto_renew: boolean | null;
  notice_period_days: number | null;
  contract_value: string | null;
}

interface CalendarEvent {
  date: string;           // YYYY-MM-DD
  contractId: string;
  contractName: string;
  partyA: string | null;
  contractValue: string | null;
  type: 'expiry' | 'notice';
  color: string;
  label: string;
  daysFromToday: number;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Mon-first
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function subtractDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function todayKey(): string {
  const now = new Date();
  return toDateKey(now.getFullYear(), now.getMonth(), now.getDate());
}

const EMPTY: CalendarEvent[] = [];

interface CalendarCellProps {
  day: number | null;
  dateStr: string | null;
  cellEvents: CalendarEvent[];
  isToday: boolean;
  isSelected: boolean;
  onSelect: (dateStr: string, isSelected: boolean) => void;
}

const CalendarCell = memo(function CalendarCell({ day, dateStr, cellEvents, isToday, isSelected, onSelect }: CalendarCellProps) {
  const hasEvents = cellEvents.length > 0;
  return (
    <div
      onClick={() => { if (hasEvents && dateStr) onSelect(dateStr, isSelected); }}
      style={{
        padding: '5px 6px',
        border: '1px solid rgba(255,255,255,0.05)',
        background: isToday
          ? 'rgba(16,185,129,0.06)'
          : isSelected
          ? 'rgba(255,255,255,0.03)'
          : 'transparent',
        outline: isToday
          ? '1px solid rgba(16,185,129,0.20)'
          : isSelected
          ? '1px solid rgba(255,255,255,0.18)'
          : 'none',
        outlineOffset: '-1px',
        cursor: hasEvents ? 'pointer' : 'default',
        boxSizing: 'border-box',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {day !== null && (
        <>
          <div style={{
            fontFamily: 'var(--font-jetbrains), monospace',
            fontSize: '11px',
            color: isToday ? '#10B981' : '#6B7280',
            fontWeight: isToday ? 700 : 400,
            textAlign: 'right',
            marginBottom: '3px',
            lineHeight: 1,
            flexShrink: 0,
          }}>
            {day}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
            {cellEvents.slice(0, 2).map((event, ei) => (
              <div
                key={ei}
                title={event.label}
                style={{
                  height: '16px',
                  borderRadius: '3px',
                  padding: '0 4px',
                  fontSize: '10px',
                  fontWeight: 500,
                  color: '#0A0F1E',
                  background: event.color,
                  opacity: 0.9,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  lineHeight: '16px',
                  flexShrink: 0,
                }}
              >
                {event.label}
              </div>
            ))}
            {cellEvents.length > 2 && (
              <div style={{
                fontSize: '9px',
                color: '#6B7280',
                padding: '0 4px',
                fontFamily: 'var(--font-jetbrains), monospace',
              }}>
                +{cellEvents.length - 2} more
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
});

export default function RenewalCalendar({ contracts }: { contracts: Contract[] }) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const todayStr = todayKey();

  // ── Compute all events ─────────────────────────────────────────────────────
  const events = useMemo<CalendarEvent[]>(() => {
    const result: CalendarEvent[] = [];
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    for (const contract of contracts) {
      const primaryDate = contract.expiry_date ?? contract.renewal_date;
      if (!primaryDate) continue;

      const [py, pm, pd] = primaryDate.split('-').map(Number);
      const target = new Date(py, pm - 1, pd);
      const days = Math.ceil((target.getTime() - now.getTime()) / 86400000);
      if (days < 0) continue;

      const color = days <= 30 ? '#EF4444' : days <= 60 ? '#F59E0B' : '#10B981';
      const label = contract.auto_renew ? `↻ ${contract.name}` : contract.name;

      result.push({
        date: primaryDate,
        contractId: contract.id,
        contractName: contract.name,
        partyA: contract.party_a,
        contractValue: contract.contract_value,
        type: 'expiry',
        color,
        label,
        daysFromToday: days,
      });

      if (contract.notice_period_days && contract.notice_period_days > 0) {
        const noticeDate = subtractDays(primaryDate, contract.notice_period_days);
        const [ny, nm, nd] = noticeDate.split('-').map(Number);
        const noticeTarget = new Date(ny, nm - 1, nd);
        const noticeDays = Math.ceil((noticeTarget.getTime() - now.getTime()) / 86400000);
        if (noticeDays >= 0) {
          result.push({
            date: noticeDate,
            contractId: contract.id,
            contractName: contract.name,
            partyA: contract.party_a,
            contractValue: contract.contract_value,
            type: 'notice',
            color: '#EF4444',
            label: `⚠ ${contract.name}`,
            daysFromToday: noticeDays,
          });
        }
      }
    }

    return result;
  }, [contracts]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const arr = map.get(event.date) ?? [];
      arr.push(event);
      map.set(event.date, arr);
    }
    return map;
  }, [events]);

  const upcomingEvents = useMemo(() => {
    return events
      .filter(e => e.daysFromToday >= 0 && e.daysFromToday <= 90)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'notice' ? -1 : 1));
  }, [events]);

  // ── Calendar grid ──────────────────────────────────────────────────────────
  const { year, month } = currentMonth;
  const firstDay = new Date(year, month, 1);
  const totalDays = new Date(year, month + 1, 0).getDate();
  const adjustedStartDow = (firstDay.getDay() + 6) % 7;

  const cells: (number | null)[] = [];
  for (let i = 0; i < adjustedStartDow; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);
  while (cells.length < 42) cells.push(null);

  const handleCellSelect = useCallback((dateStr: string, isSelected: boolean) => {
    setSelectedDate(isSelected ? null : dateStr);
  }, []);

  // ── Navigation ─────────────────────────────────────────────────────────────
  const prevMonth = () => setCurrentMonth(prev => {
    const d = new Date(prev.year, prev.month - 1, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const nextMonth = () => setCurrentMonth(prev => {
    const d = new Date(prev.year, prev.month + 1, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const goToToday = () => {
    const now = new Date();
    setCurrentMonth({ year: now.getFullYear(), month: now.getMonth() });
    setSelectedDate(null);
  };

  // ── Relative date label ────────────────────────────────────────────────────
  function getRelativeLabel(days: number): string {
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days <= 7) {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return d.toLocaleDateString('en-GB', { weekday: 'long' });
    }
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  const selectedEvents = selectedDate ? (eventsByDate.get(selectedDate) ?? []) : [];

  const navBtnStyle: React.CSSProperties = {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.08)',
    color: '#9CA3AF',
    borderRadius: '4px',
    padding: '4px 12px',
    cursor: 'pointer',
    fontFamily: 'var(--font-jetbrains), monospace',
    fontSize: '14px',
    lineHeight: 1,
    flexShrink: 0,
  };

  const todayBtnStyle: React.CSSProperties = {
    background: 'transparent',
    border: '1px solid rgba(16,185,129,0.25)',
    color: '#10B981',
    borderRadius: '4px',
    padding: '4px 12px',
    cursor: 'pointer',
    fontFamily: 'var(--font-jetbrains), monospace',
    fontSize: '12px',
    flexShrink: 0,
  };

  return (
    // Fills the flex:1 main — must be a flex column itself
    <div style={{
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>

      {/* ── Month header ─────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '12px',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={prevMonth} style={navBtnStyle} aria-label="Previous month">←</button>
          <h1 style={{
            fontFamily: 'var(--font-jetbrains), monospace',
            fontSize: '18px',
            fontWeight: 700,
            color: '#F9FAFB',
            letterSpacing: '-0.01em',
            margin: 0,
            minWidth: '188px',
            textAlign: 'center',
          }}>
            {MONTH_NAMES[month]} {year}
          </h1>
          <button onClick={nextMonth} style={navBtnStyle} aria-label="Next month">→</button>
        </div>
        <button onClick={goToToday} style={todayBtnStyle}>Today</button>
      </div>

      {/* ── Main layout — fills remaining height ─────────────────────────────── */}
      <div style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        gap: '16px',
        overflow: 'hidden',
      }}>

        {/* ── Calendar column (70%) ─────────────────────────────────────────── */}
        <div style={{
          flex: '0 0 70%',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>

          {/* Day-of-week headers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            flexShrink: 0,
            marginBottom: '2px',
          }}>
            {DAY_NAMES.map(day => (
              <div key={day} style={{
                textAlign: 'center',
                fontFamily: 'var(--font-jetbrains), monospace',
                fontSize: '10px',
                fontWeight: 600,
                color: '#4B5563',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                padding: '4px 0 6px',
              }}>
                {day}
              </div>
            ))}
          </div>

          {/* Grid — fills all remaining height */}
          <div style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gridTemplateRows: 'repeat(6, 1fr)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '8px',
            overflow: 'hidden',
          }}>
            {cells.map((day, i) => {
              const dateStr = day !== null ? toDateKey(year, month, day) : null;
              const cellEvents = dateStr ? (eventsByDate.get(dateStr) ?? EMPTY) : EMPTY;
              return (
                <CalendarCell
                  key={i}
                  day={day}
                  dateStr={dateStr}
                  cellEvents={cellEvents}
                  isToday={dateStr === todayStr}
                  isSelected={dateStr === selectedDate}
                  onSelect={handleCellSelect}
                />
              );
            })}
          </div>
        </div>

        {/* ── Sidebar (30%) ─────────────────────────────────────────────────── */}
        <div style={{
          flex: '0 0 calc(30% - 16px)',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>

          {selectedDate && selectedEvents.length > 0 ? (
            /* ── Selected date detail ──────────────────────────────────────── */
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              overflow: 'hidden',
            }}>
              {/* Header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '12px',
                flexShrink: 0,
              }}>
                <div style={{
                  fontFamily: 'var(--font-jetbrains), monospace',
                  fontSize: '10px',
                  fontWeight: 700,
                  color: '#6B7280',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}>
                  {(() => {
                    const [sy, sm, sd] = selectedDate.split('-').map(Number);
                    return new Date(sy, sm - 1, sd).toLocaleDateString('en-GB', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    });
                  })()}
                </div>
                <button
                  onClick={() => setSelectedDate(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#4B5563',
                    cursor: 'pointer',
                    fontSize: '16px',
                    lineHeight: 1,
                    padding: '0 2px',
                  }}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              {/* Events list */}
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                  {selectedEvents.map((event, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'stretch',
                        gap: '12px',
                        padding: '12px 0',
                        borderBottom: i < selectedEvents.length - 1
                          ? '1px solid rgba(255,255,255,0.05)'
                          : 'none',
                      }}
                    >
                      <div style={{
                        width: '3px',
                        background: event.color,
                        borderRadius: '2px',
                        flexShrink: 0,
                        alignSelf: 'stretch',
                        minHeight: '40px',
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: '13px',
                          fontWeight: 500,
                          color: '#F9FAFB',
                          marginBottom: '4px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {event.contractName}
                        </div>
                        <div style={{
                          display: 'flex',
                          gap: '8px',
                          alignItems: 'center',
                          marginBottom: '5px',
                          flexWrap: 'wrap',
                        }}>
                          <span style={{
                            fontFamily: 'var(--font-jetbrains), monospace',
                            fontSize: '9px',
                            fontWeight: 700,
                            color: event.color,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                          }}>
                            {event.type === 'expiry' ? 'Expiry' : 'Notice Deadline'}
                          </span>
                          {event.partyA && (
                            <span style={{ fontSize: '11px', color: '#6B7280' }}>{event.partyA}</span>
                          )}
                          {event.contractValue && (
                            <span style={{ fontSize: '11px', color: '#6B7280' }}>{event.contractValue}</span>
                          )}
                        </div>
                        <Link
                          href={`/dashboard/contracts/${event.contractId}`}
                          style={{ fontSize: '11px', color: '#10B981', textDecoration: 'none', fontWeight: 500 }}
                        >
                          View contract →
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          ) : (
            /* ── Upcoming list ─────────────────────────────────────────────── */
            <>
              <div style={{
                fontFamily: 'var(--font-jetbrains), monospace',
                fontSize: '10px',
                fontWeight: 700,
                color: '#4B5563',
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                marginBottom: '10px',
                flexShrink: 0,
              }}>
                Next 90 Days
              </div>

              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                {contracts.length === 0 ? (
                  <div style={{
                    padding: '20px 14px',
                    background: 'rgba(16,185,129,0.04)',
                    border: '1px solid rgba(16,185,129,0.12)',
                    borderRadius: '8px',
                    textAlign: 'center',
                  }}>
                    <div style={{ fontSize: '13px', color: '#9CA3AF', marginBottom: '6px', fontWeight: 500 }}>
                      Your calendar is empty
                    </div>
                    <div style={{ fontSize: '12px', color: '#6B7280', lineHeight: 1.6 }}>
                      Upload and confirm contracts to see renewal dates plotted here.
                    </div>
                    <Link
                      href="/dashboard"
                      style={{
                        display: 'inline-block',
                        marginTop: '10px',
                        fontSize: '12px',
                        color: '#10B981',
                        textDecoration: 'none',
                        fontWeight: 500,
                      }}
                    >
                      Go to dashboard →
                    </Link>
                  </div>
                ) : upcomingEvents.length === 0 ? (
                  <div style={{
                    fontSize: '13px',
                    color: '#4B5563',
                    textAlign: 'center',
                    padding: '24px 0',
                    lineHeight: 1.6,
                  }}>
                    No renewals in the<br />next 90 days.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {upcomingEvents.map((event, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          background: 'rgba(255,255,255,0.02)',
                          borderRadius: '4px',
                          overflow: 'hidden',
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          const [ey, em] = event.date.split('-').map(Number);
                          setCurrentMonth({ year: ey, month: em - 1 });
                          setSelectedDate(event.date);
                        }}
                      >
                        <div style={{
                          width: '3px',
                          alignSelf: 'stretch',
                          background: event.color,
                          flexShrink: 0,
                        }} />
                        <div style={{
                          flex: 1,
                          minWidth: 0,
                          padding: '7px 9px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: '12px',
                              color: '#F9FAFB',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              marginBottom: '1px',
                            }}>
                              {event.contractName}
                            </div>
                            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                              <span style={{
                                fontFamily: 'var(--font-jetbrains), monospace',
                                fontSize: '9px',
                                fontWeight: 700,
                                color: event.color,
                                letterSpacing: '0.06em',
                                textTransform: 'uppercase',
                              }}>
                                {event.type === 'expiry' ? 'Expiry' : 'Notice'}
                              </span>
                              <span style={{ fontSize: '10px', color: '#6B7280' }}>
                                {getRelativeLabel(event.daysFromToday)}
                              </span>
                            </div>
                          </div>
                          <div style={{
                            fontFamily: 'var(--font-jetbrains), monospace',
                            fontSize: '12px',
                            color: event.color,
                            fontWeight: 600,
                            flexShrink: 0,
                            whiteSpace: 'nowrap',
                          }}>
                            {event.daysFromToday === 0 ? 'Today' : `${event.daysFromToday}d`}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Legend */}
              {upcomingEvents.length > 0 && (
                <div style={{
                  flexShrink: 0,
                  marginTop: '12px',
                  paddingTop: '12px',
                  borderTop: '1px solid rgba(255,255,255,0.05)',
                  display: 'flex',
                  gap: '12px',
                  flexWrap: 'wrap',
                }}>
                  {[
                    { color: '#10B981', label: '>60d' },
                    { color: '#F59E0B', label: '31–60d' },
                    { color: '#EF4444', label: '≤30d' },
                  ].map(({ color, label }) => (
                    <div key={color} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <div style={{
                        width: '8px', height: '8px',
                        borderRadius: '2px',
                        background: color,
                        flexShrink: 0,
                      }} />
                      <span style={{
                        fontSize: '10px',
                        color: '#4B5563',
                        fontFamily: 'var(--font-jetbrains), monospace',
                      }}>
                        {label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
