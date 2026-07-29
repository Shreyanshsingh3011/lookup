import { useEffect, useState } from 'react';
import { fetchPasses, fetchTles } from './api/client';
import { LocationPicker } from './components/LocationPicker';
import { PassTable } from './components/PassTable';
import { SourceBanner } from './components/SourceBanner';
import { TimeScrubber } from './components/TimeScrubber';
import { SkyDome } from './components/sky/SkyDome';
import { useLocation } from './hooks/useLocation';
import { useTimeControl } from './hooks/useTimeControl';
import type { Pass, TleRecord, TleSource } from './types';

function App() {
  const { observer, source: locationSource, geoStatus, geoError, useGeolocation, setManualLocation } = useLocation();
  const time = useTimeControl();

  const [passes, setPasses] = useState<Pass[]>([]);
  const [passesLoading, setPassesLoading] = useState(true);
  const [passesError, setPassesError] = useState<string | null>(null);

  const [tles, setTles] = useState<TleRecord[]>([]);
  const [tlesLoading, setTlesLoading] = useState(true);
  const [dataSource, setDataSource] = useState<TleSource | null>(null);

  // Orbital elements drive the 3D dome; the client propagates them locally so
  // positions can update every frame without hitting the server.
  useEffect(() => {
    let cancelled = false;
    setTlesLoading(true);
    fetchTles('stations')
      .then((res) => {
        if (cancelled) return;
        setTles(res.tles);
        setDataSource(res.source);
      })
      .catch(() => {
        if (!cancelled) setTles([]);
      })
      .finally(() => {
        if (!cancelled) setTlesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPassesLoading(true);
    setPassesError(null);
    fetchPasses(observer, { groups: ['stations'], days: 10 })
      .then((res) => {
        if (cancelled) return;
        setPasses(res.passes);
        setDataSource(res.source);
      })
      .catch((err) => {
        if (cancelled) return;
        setPassesError(err instanceof Error ? err.message : 'Failed to load passes');
        setPasses([]);
      })
      .finally(() => {
        if (!cancelled) setPassesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [observer]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-space-800/80 sticky top-0 z-20 backdrop-blur-lg bg-space-950/70">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-glow">Lookup</h1>
            <p className="text-xs text-space-300">Satellite tracking &amp; astronomy</p>
          </div>
          <LocationPicker
            observer={observer}
            source={locationSource}
            geoStatus={geoStatus}
            geoError={geoError}
            onUseGeolocation={useGeolocation}
            onSetManual={setManualLocation}
          />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 flex flex-col gap-6">
        <SourceBanner source={dataSource} />

        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-medium text-space-100">What's up right now</h2>
            <p className="text-xs text-space-300 hidden sm:block">Interactive sky dome · your horizon</p>
          </div>
          <SkyDome
            tles={tles}
            observer={observer}
            displayTime={time.displayTime}
            passes={passes}
            loading={tlesLoading}
          />
          <TimeScrubber control={time} />
        </section>

        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-medium text-space-100">Upcoming visible passes</h2>
            <p className="text-xs text-space-300">Next 10 days · ISS &amp; space stations</p>
          </div>
          <PassTable passes={passes} loading={passesLoading} error={passesError} />
        </section>
      </main>
    </div>
  );
}

export default App;
