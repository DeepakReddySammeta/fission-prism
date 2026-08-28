import React, { useEffect, useRef, useState } from 'react';
import type { WeatherReading } from '../types';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8787';

/** Live third-party data, not a governed record (see backend/src/weather/
 * weather.ts) — this card is deliberately styled apart from the flights/
 * hotels surfaces (dashed border, a "Live" badge) so it never reads as one
 * more approved result sitting in that list. As a trip-plan side dish a fetch
 * failure is silent — a demo forecast going down shouldn't take the rest of
 * the plan with it — but when the weather *is* the whole answer the user
 * asked for (`standalone`), a failure says so rather than rendering nothing
 * under the summary line. */

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Counts up to the target value on mount/change instead of popping in —
 * skipped entirely under prefers-reduced-motion. */
function useCountUp(target: number, active: boolean, durationMs = 700): number {
  const [value, setValue] = useState(active ? 0 : target);
  const fromRef = useRef(0);

  useEffect(() => {
    if (!active || !Number.isFinite(target)) { setValue(target); return; }
    if (prefersReducedMotion()) { setValue(target); return; }
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, active]);

  return value;
}

type Visual = { icon: string; anim: string };

function visualFor(condition: string, isDay: boolean): Visual {
  const c = condition.toLowerCase();
  if (c.includes('thunder')) return { icon: '⛈️', anim: 'wx-storm' };
  if (c.includes('snow')) return { icon: '❄️', anim: 'wx-snow' };
  if (c.includes('drizzle') || c.includes('rain') || c.includes('shower')) return { icon: '🌧️', anim: 'wx-rain' };
  if (c.includes('fog') || c.includes('rime')) return { icon: '🌫️', anim: 'wx-drift' };
  if (c.includes('overcast')) return { icon: '☁️', anim: 'wx-drift' };
  if (c.includes('partly')) return { icon: isDay ? '⛅' : '☁️', anim: 'wx-drift' };
  if (c.includes('clear') || c.includes('mainly clear')) return isDay ? { icon: '☀️', anim: 'wx-sun' } : { icon: '🌙', anim: 'wx-moon' };
  return { icon: isDay ? '🌤️' : '🌙', anim: isDay ? 'wx-drift' : 'wx-moon' };
}

function dayLabel(iso: string, index: number): string {
  if (index === 0) return 'Today';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

export function WeatherCard({ destination, standalone = false }: { destination?: string; standalone?: boolean }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [data, setData] = useState<WeatherReading | null>(null);

  useEffect(() => {
    const place = (destination || '').trim();
    if (!place) { setStatus('idle'); setData(null); return; }
    const controller = new AbortController();
    setStatus('loading');
    fetch(`${API}/api/weather?place=${encodeURIComponent(place)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((reading: WeatherReading) => { setData(reading); setStatus('ready'); })
      .catch((err) => { if (err?.name !== 'AbortError') setStatus('error'); });
    return () => controller.abort();
  }, [destination]);

  const active = status === 'ready';
  const temp = useCountUp(data ? Math.round(data.temperatureC) : 0, active);

  if (status === 'idle') return null;
  if (status === 'error') {
    if (!standalone) return null;
    return (
      <div className="weather-card reveal">
        <div className="weather-card-heading">Weather for {destination}</div>
        <div className="weather-card-condition">
          I couldn't pull a live reading for {destination} right now — double-check the place name, or try again in a moment.
        </div>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="weather-card weather-card-loading reveal">
        <div className="wx-skel-icon" />
        <div className="wx-skel-lines">
          <div className="skel-line skel-w-140" />
          <div className="skel-line skel-w-140" style={{ opacity: 0.6 }} />
        </div>
      </div>
    );
  }

  if (!data) return null;
  const visual = visualFor(data.condition, data.isDay);

  return (
    <div className="weather-card reveal">
      <div className="weather-card-heading">
        {standalone
          ? `Current weather in ${destination}`
          : `Since you're planning a trip to ${destination}, here's the weather report`}
      </div>
      <div className="weather-card-main">
        <span className={`wx-icon ${visual.anim}`} aria-hidden>{visual.icon}</span>
        <div className="weather-card-info">
          <div className="weather-card-place">{data.place}</div>
          <div className="weather-card-condition">{data.condition} · Feels like {Math.round(data.feelsLikeC)}°</div>
          <div className="weather-card-meta">💧 {data.humidityPercent}% · 💨 {Math.round(data.windKph)} km/h</div>
        </div>
        <div className="weather-card-temp">
          {Math.round(temp)}<span className="weather-card-deg">°C</span>
        </div>
      </div>

      {data.daily.length > 0 && (
        <div className="weather-forecast">
          {data.daily.map((d, i) => {
            const v = visualFor(d.condition, true);
            return (
              <div className="weather-forecast-day reveal" style={{ animationDelay: `${i * 70}ms` }} key={d.date}>
                <span className="weather-forecast-label">{dayLabel(d.date, i)}</span>
                <span className="wx-icon wx-icon-sm" aria-hidden>{v.icon}</span>
                <span className="weather-forecast-range">
                  <strong>{Math.round(d.maxC)}°</strong> <span className="muted">{Math.round(d.minC)}°</span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="weather-card-attribution">
        <span className="weather-live-dot" aria-hidden />
        Live weather from {data.provider} — not a saved trip record
      </div>
    </div>
  );
}
