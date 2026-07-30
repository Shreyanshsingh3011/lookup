import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchCustomPasses, fetchPasses, fetchTles } from './api/client';
import { AddSatellite } from './components/AddSatellite';
import { ConjunctionScan } from './components/ConjunctionScan';
import { LocationPicker } from './components/LocationPicker';
import { OrbitAdvisor } from './components/OrbitAdvisor';
import { PassDetail } from './components/PassDetail';
import { PassTable } from './components/PassTable';
import { SourceBanner } from './components/SourceBanner';
import { WeatherNotice } from './components/CloudCover';
import { TimeScrubber } from './components/TimeScrubber';
import { SkyDome } from './components/sky/SkyDome';
import { useLocation } from './hooks/useLocation';
import { useTimeControl } from './hooks/useTimeControl';
import { downloadTextFile, passesToCsv, tlesToText } from './lib/exportData';
import type { EpochSpan, Pass, TleRecord, TleSource } from './types';

const MAX_CUSTOM_SATELLITES = 20;

function App() {
  const { observer, source: locationSource, geoStatus, geoError, useGeolocation, setManualLocation } = useLocation();
  const time = useTimeControl();

  const [passes, setPasses] = useState<Pass[]>([]);
  const [passesLoading, setPassesLoading] = useState(true);
  const [passesError, setPassesError] = useState<string | null>(null);

  const [tles, setTles] = useState<TleRecord[]>([]);
  const [tlesLoading, setTlesLoading] = useState(true);
  const [dataSource, setDataSource] = useState<TleSource | null>(null);
  const [dataEpoch, setDataEpoch] = useState<EpochSpan | null>(null);
  const [selectedPass, setSelectedPass] = useState<Pass | null>(null);
  const [passSummary, setPassSummary] = useState<{
    tooFaintCount: number;
    brightestRejectedMagnitude: number | null;
    satelliteCount: number;
    weather: { status: 'live' | 'cache' | 'unavailable'; error?: string };
  } | null>(null);

  const [customTles, setCustomTles] = useState<TleRecord[]>([]);
  const [customPasses, setCustomPasses] = useState<Pass[]>([]);
  const [customPassesLoading, setCustomPassesLoading] = useState(false);
  const [customPassesError, setCustomPassesError] = useState<string | null>(null);
  const [customSummary, setCustomSummary] = useState<{
    tooFaintCount: number;
    brightestRejectedMagnitude: number | null;
    satelliteCount: number;
  } | null>(null);

  const allTles = useMemo(() => [...tles, ...customTles], [tles, customTles]);
  const allPasses = useMemo(() => [...passes, ...customPasses], [passes, customPasses]);

  const combinedSummary = useMemo(() => {
    if (!passSummary && !customSummary) return null;
    const brightestValues = [passSummary?.brightestRejectedMagnitude, customSummary?.brightestRejectedMagnitude].filter(
      (m): m is number => m !== null && m !== undefined
    );
    return {
      tooFaintCount: (passSummary?.tooFaintCount ?? 0) + (customSummary?.tooFaintCount ?? 0),
      satelliteCount: (passSummary?.satelliteCount ?? 0) + (customSummary?.satelliteCount ?? 0),
      brightestRejectedMagnitude: brightestValues.length > 0 ? Math.min(...brightestValues) : null,
    };
  }, [passSummary, customSummary]);

  const addCustomSatellite = (tle: TleRecord): string | null => {
    if (tles.some((t) => t.satnum === tle.satnum) || customTles.some((t) => t.satnum === tle.satnum)) {
      return `${tle.name} (#${tle.satnum}) is already tracked.`;
    }
    if (customTles.length >= MAX_CUSTOM_SATELLITES) {
      return `You can track up to ${MAX_CUSTOM_SATELLITES} custom satellites at once.`;
    }
    setCustomTles((prev) => [...prev, tle]);
    return null;
  };

  const removeCustomSatellite = (satnum: string) => {
    setCustomTles((prev) => prev.filter((t) => t.satnum !== satnum));
  };

  const skySectionRef = useRef<HTMLElement>(null);

  const showPassInSky = (pass: Pass) => {
    // Start a couple of minutes before the pass so the approach is visible.
    time.goToTime(new Date(pass.start.time));
    skySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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
        setDataEpoch(res.epoch);
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
        setDataEpoch(res.epoch);
        setPassSummary({
          tooFaintCount: res.tooFaintCount,
          brightestRejectedMagnitude: res.brightestRejectedMagnitude,
          satelliteCount: res.satelliteCount,
          weather: res.weather,
        });
        // The previous selection belongs to the old location's predictions.
        setSelectedPass(null);
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

  // Passes for user-added satellites are computed separately from the bundled
  // "stations" group, since they didn't come from a Celestrak group fetch.
  useEffect(() => {
    if (customTles.length === 0) {
      setCustomPasses([]);
      setCustomSummary(null);
      setCustomPassesError(null);
      return;
    }
    let cancelled = false;
    setCustomPassesLoading(true);
    setCustomPassesError(null);
    fetchCustomPasses(observer, customTles, { days: 10 })
      .then((res) => {
        if (cancelled) return;
        setCustomPasses(res.passes);
        setCustomSummary({
          tooFaintCount: res.tooFaintCount,
          brightestRejectedMagnitude: res.brightestRejectedMagnitude,
          satelliteCount: res.satelliteCount,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setCustomPassesError(err instanceof Error ? err.message : 'Failed to load passes for tracked satellites');
        setCustomPasses([]);
      })
      .finally(() => {
        if (!cancelled) setCustomPassesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [observer, customTles]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-space-800/80 sticky top-0 z-20 backdrop-blur-lg bg-space-950/70 print:hidden">
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
        <SourceBanner source={dataSource} epoch={dataEpoch} />

        <section className="flex flex-col gap-2 print:hidden" ref={skySectionRef}>
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-medium text-space-100">What's up right now</h2>
            <p className="text-xs text-space-300 hidden sm:block">Interactive sky dome · your horizon</p>
          </div>
          <SkyDome
            tles={allTles}
            observer={observer}
            displayTime={time.displayTime}
            passes={allPasses}
            loading={tlesLoading}
          />
          <TimeScrubber control={time} />
        </section>

        {selectedPass && (
          <PassDetail
            pass={selectedPass}
            observer={observer}
            tles={allTles}
            onClose={() => setSelectedPass(null)}
            onShowInSky={showPassInSky}
          />
        )}

        <section className="print:hidden">
          <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-medium text-space-100">Upcoming visible passes</h2>
              <p className="text-xs text-space-300">
                Next 10 days · ISS &amp; space stations
                <span className="hidden sm:inline"> · click a pass for its sky track</span>
              </p>
            </div>
            {allPasses.length > 0 && (
              <button
                type="button"
                onClick={() => downloadTextFile('lookup-passes.csv', passesToCsv(allPasses), 'text/csv')}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-space-700/60 text-space-200 border border-space-600 hover:bg-space-700 transition"
              >
                Export CSV
              </button>
            )}
          </div>
          <PassTable
            passes={allPasses}
            loading={passesLoading}
            error={passesError}
            selectedPass={selectedPass}
            onSelectPass={setSelectedPass}
            tooFaintCount={combinedSummary?.tooFaintCount}
            brightestRejectedMagnitude={combinedSummary?.brightestRejectedMagnitude}
            satelliteCount={combinedSummary?.satelliteCount}
          />
          {passSummary && <WeatherNotice {...passSummary.weather} />}
          {customPassesError && <p className="text-xs text-amber-glow mt-2">{customPassesError}</p>}
        </section>

        <section className="print:hidden">
          <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-medium text-space-100">Track a satellite of your own</h2>
              <p className="text-xs text-space-300">
                {customPassesLoading ? 'Computing passes…' : 'By NORAD ID or a pasted TLE'}
              </p>
            </div>
            {allTles.length > 0 && (
              <button
                type="button"
                onClick={() => downloadTextFile('lookup-tles.txt', tlesToText(allTles), 'text/plain')}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-space-700/60 text-space-200 border border-space-600 hover:bg-space-700 transition"
              >
                Export TLEs ({allTles.length})
              </button>
            )}
          </div>
          <AddSatellite customTles={customTles} onAdd={addCustomSatellite} onRemove={removeCustomSatellite} />
        </section>

        <section className="print:hidden">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-medium text-space-100">Close approaches</h2>
            <p className="text-xs text-space-300">Geometric proximity only — not a collision assessment</p>
          </div>
          <ConjunctionScan tles={allTles} />
        </section>

        <section className="print:hidden">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-medium text-space-100">Planning a launch?</h2>
            <p className="text-xs text-space-300">AI-assisted, grounded in orbital mechanics</p>
          </div>
          <OrbitAdvisor observer={observer} />
        </section>
      </main>
    </div>
  );
}

export default App;
