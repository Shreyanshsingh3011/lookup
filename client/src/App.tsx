import { useEffect, useState } from 'react';
import { fetchPasses } from './api/client';
import { LocationPicker } from './components/LocationPicker';
import { PassTable } from './components/PassTable';
import { useLocation } from './hooks/useLocation';
import type { Pass } from './types';

function App() {
  const { observer, source, geoStatus, geoError, useGeolocation, setManualLocation } = useLocation();
  const [passes, setPasses] = useState<Pass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPasses(observer, { groups: ['stations'], days: 10 })
      .then((res) => {
        if (cancelled) return;
        setPasses(res.passes);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load passes');
        setPasses([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [observer]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-space-800/80 sticky top-0 z-10 backdrop-blur-lg bg-space-950/70">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-glow">Lookup</h1>
            <p className="text-xs text-space-300">Satellite tracking &amp; astronomy</p>
          </div>
          <LocationPicker
            observer={observer}
            source={source}
            geoStatus={geoStatus}
            geoError={geoError}
            onUseGeolocation={useGeolocation}
            onSetManual={setManualLocation}
          />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 flex flex-col gap-6">
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-medium text-space-100">Upcoming visible passes</h2>
            <p className="text-xs text-space-300">Next 10 days · ISS &amp; space stations</p>
          </div>
          <PassTable passes={passes} loading={loading} error={error} />
        </section>

        <section className="glass-panel rounded-xl p-6 text-center text-space-300 text-sm">
          3D sky dome, time scrubber, and star chart are coming in the next milestones.
        </section>
      </main>
    </div>
  );
}

export default App;
