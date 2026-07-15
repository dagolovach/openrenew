"use client";

import { useState, useEffect } from "react";

// Set launch date — 30 days from project start (2026-03-21)
const LAUNCH_DATE = new Date("2026-04-21T00:00:00Z");

function getTimeLeft() {
  const diff = LAUNCH_DATE.getTime() - Date.now();
  if (diff <= 0) {
    return { days: "00", hours: "00", minutes: "00", seconds: "00", expired: true };
  }
  return {
    days: String(Math.floor(diff / 86400000)).padStart(2, "0"),
    hours: String(Math.floor((diff % 86400000) / 3600000)).padStart(2, "0"),
    minutes: String(Math.floor((diff % 3600000) / 60000)).padStart(2, "0"),
    seconds: String(Math.floor((diff % 60000) / 1000)).padStart(2, "0"),
    expired: false,
  };
}

const INITIAL = { days: "00", hours: "00", minutes: "00", seconds: "00", expired: false };

export default function CountdownTimer() {
  const [timeLeft, setTimeLeft] = useState<ReturnType<typeof getTimeLeft> | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTimeLeft(getTimeLeft());
    let timer: ReturnType<typeof setTimeout>;
    function schedule() {
      timer = setTimeout(() => { setTimeLeft(getTimeLeft()); schedule(); }, 1000);
    }
    schedule();
    return () => clearTimeout(timer);
  }, []);

  // Digits hidden until JS hydrates, then fade in
  const digitStyle = {
    opacity: timeLeft ? 1 : 0,
    transition: "opacity 0.3s ease",
  };

  const t = timeLeft ?? INITIAL;

  return (
    <div className="countdown-block">
      <div className="card-scanline"></div>
      <div className="cd-lbl">Time remaining</div>
      <div className="cd-display">
        <div className="cd-seg">
          <div className="cd-num" style={digitStyle}>
            {t.expired ? <span style={{ color: "#EF4444", fontSize: "1.4rem" }}>EXPIRED</span> : t.days}
          </div>
          <div className="cd-unit">{t.expired ? "" : "days"}</div>
        </div>
        {!t.expired && (
          <>
            <div className="cd-sep">:</div>
            <div className="cd-seg">
              <div className="cd-num" style={digitStyle}>{t.hours}</div>
              <div className="cd-unit">hrs</div>
            </div>
            <div className="cd-sep">:</div>
            <div className="cd-seg">
              <div className="cd-num" style={digitStyle}>{t.minutes}</div>
              <div className="cd-unit">min</div>
            </div>
            <div className="cd-sep">:</div>
            <div className="cd-seg">
              <div className="cd-num cd-seconds" style={digitStyle}>{t.seconds}</div>
              <div className="cd-unit">sec</div>
            </div>
          </>
        )}
      </div>
      <div className="cd-status">
        <span className="dot-live"></span>
        {t.expired ? "CONTRACT EXPIRED" : "ALERT ACTIVE · 7-DAY WARNING SCHEDULED"}
      </div>
    </div>
  );
}
