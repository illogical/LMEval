import { useState, useEffect } from 'react';
import './ElapsedTimer.css';

interface ElapsedTimerProps {
  startTime: number;  // unix ms
  stopped?: boolean;
}

export function ElapsedTimer({ startTime, stopped = false }: ElapsedTimerProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(Date.now() - startTime);
    if (stopped) return;
    const id = setInterval(() => setElapsed(Date.now() - startTime), 1000);
    return () => clearInterval(id);
  }, [startTime, stopped]);

  const totalSec = Math.floor(elapsed / 1000);
  const h = Math.floor(totalSec / 3600).toString().padStart(2, '0');
  const m = Math.floor((totalSec % 3600) / 60).toString().padStart(2, '0');
  const s = (totalSec % 60).toString().padStart(2, '0');

  return (
    <div className="elapsed-timer" aria-label="Elapsed time">
      <span className="et-clock">{h}:{m}:{s}</span>
    </div>
  );
}
