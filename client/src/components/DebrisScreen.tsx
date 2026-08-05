import { useEffect, useMemo, useState } from 'react';
import { fetchCustomPasses, fetchDebrisCatalogue, fetchDebrisCloud, fetchTransmitters } from '../api/client';
import { PassTable } from './PassTable';
import { assessRisk, preFilter, type Freshness } from '../lib/debris';
import type {
  DebrisCatalogueResponse,
  DebrisCloudResponse,
  Observer,
  Pass,
  ResolvedDerelict,
  TransmitterResponse,
} from '../types';

/**
 * Space debris and dead satellites.
 *
 * Its own screen rather than another band in the picker, because the questions
 * are different. The sky screen asks what you can see tonight; this one asks
 * what is still up there, whether anyone is still talking to it, and whether
 * the numbers describing it can still be believed.
 *
 * Two collections share the screen and stay separate throughout. Derelicts are
 * individual objects with names and stories, several of them genuinely
 * naked-eye. Clouds are breakup events: three thousand fragments that are, one
 * by one, far too faint to see, and interesting as a population rather than as
 * targets. Presenting them as one filtered list would flatter the fragments and
 * bury the derelicts.
 */

const FRESHNESS_STYLE: Record<Freshness['level'], string> = {
  fresh: 'text-emerald-300',
  ageing: 'text-space-300',
  stale: 'text-amber-glow',
  unusable: 'text-red-300',
};

function formatAge(days: number | null): string {
  if (days === null) return 'unknown age';
  if (days < 0) return 'just published';
  if (days < 1) return `${Math.round(days * 24)} h old`;
  if (days < 60) return `${days.toFixed(1)} d old`;
  return `${(days / 365.25).toFixed(1)} yr old`;
}

export function DebrisScreen({
  observer,
  displayTime,
  onLogSighting,
  selectedPass,
  onSelectPass,
  onShowInSky,
  onShowCloudInSky,
}: {
  observer: Observer;
  displayTime: Date;
  onLogSighting: (subject: string, satnum: string | null) => void;
  selectedPass: Pass | null;
  onSelectPass: (pass: Pass | null) => void;
  /** Switch to the Sky tab with the debris layer turned on. */
  onShowInSky: () => void;
  /** Hand a loaded cloud to the dome, to be shaded as a region. */
  onShowCloudInSky: (cloud: DebrisCloudResponse) => void;
}) {
  const [catalogue, setCatalogue] = useState<DebrisCatalogueResponse | null>(null);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [openCloud, setOpenCloud] = useState<DebrisCloudResponse | null>(null);
  const [loadingCloud, setLoadingCloud] = useState<string | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDebrisCatalogue()
      .then((res) => !cancelled && setCatalogue(res))
      .catch((err) => !cancelled && setCatalogueError(err instanceof Error ? err.message : 'Could not load the catalogue'));
    return () => {
      cancelled = true;
    };
  }, []);

  const loadCloud = (id: string) => {
    setLoadingCloud(id);
    setCloudError(null);
    fetchDebrisCloud(id)
      .then((res) => setOpenCloud(res))
      .catch((err) => setCloudError(err instanceof Error ? err.message : 'Could not load that cloud'))
      .finally(() => setLoadingCloud(null));
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium text-space-100">Derelicts worth finding</h2>
            <p className="text-xs text-space-300">
              Dead satellites and spent rocket stages, looked up one at a time
            </p>
          </div>
          <button
            type="button"
            onClick={onShowInSky}
            className="text-xs px-3 py-1.5 rounded-lg bg-glow-600/20 text-glow-400 border border-glow-600/40 hover:bg-glow-600/30 transition shrink-0"
          >
            Show these in the live sky
          </button>
        </div>
        <p className="text-[11px] text-space-400">
          These same objects can be drawn in the sky dome on the Sky tab, in amber, alongside the
          active satellites — the “Debris” layer button turns them on.
        </p>

        {catalogueError && (
          <p className="glass-panel rounded-xl px-4 py-3 text-sm text-amber-glow">
            {catalogueError} Nothing below can be shown until the catalogue answers.
          </p>
        )}

        {catalogue && (
          <div className="glass-panel rounded-xl divide-y divide-space-800/60">
            {catalogue.derelicts.map((derelict) => (
              <DerelictRow
                key={derelict.entry.satnum}
                derelict={derelict}
                observer={observer}
                displayTime={displayTime}
                onLogSighting={onLogSighting}
              />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div>
          <h2 className="text-lg font-medium text-space-100">Breakup clouds</h2>
          <p className="text-xs text-space-300">
            Four events that between them account for much of what is up there
          </p>
        </div>

        <div className="glass-panel rounded-xl divide-y divide-space-800/60">
          {(catalogue?.clouds ?? []).map((cloud) => (
            <div key={cloud.id} className="px-4 py-3 flex flex-wrap items-start gap-x-4 gap-y-2">
              <div className="flex-1 min-w-[16rem]">
                <div className="text-sm font-medium text-space-100">
                  {cloud.label}
                  <span className="ml-2 text-[11px] font-normal text-space-400">
                    {new Date(cloud.eventDate).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </span>
                </div>
                <p className="text-[11px] text-space-300 leading-relaxed mt-0.5">{cloud.event}</p>
                {/* Two different numbers, and saying which is which matters:
                    the peak is history, the live count is what is still up
                    there. Showing the peak alone read as the present and
                    overstated every cloud — Cosmos 1408 by five hundred fold. */}
                <p className="text-[11px] text-space-400 mt-1">
                  {openCloud?.cloud.id === cloud.id ? (
                    <>
                      <span className="text-amber-glow">
                        {openCloud.count.toLocaleString()} still catalogued
                      </span>{' '}
                      of about {cloud.peakCatalogued.toLocaleString()} at its peak
                    </>
                  ) : (
                    <>about {cloud.peakCatalogued.toLocaleString()} fragments catalogued at its peak</>
                  )}
                  , spread from {cloud.altitudeBandKm[0]} to{' '}
                  {cloud.altitudeBandKm[1].toLocaleString()} km. Drag has been removing them from the
                  bottom up ever since.
                </p>
              </div>
              <button
                type="button"
                onClick={() => loadCloud(cloud.id)}
                disabled={loadingCloud !== null}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-space-700/60 text-space-200 border border-space-600 hover:bg-space-700 transition disabled:opacity-50 shrink-0"
              >
                {loadingCloud === cloud.id ? 'Loading…' : 'Load fragments'}
              </button>
            </div>
          ))}
        </div>

        {cloudError && <p className="text-xs text-amber-glow">{cloudError}</p>}
        {openCloud && (
          <CloudDetail
            data={openCloud}
            observer={observer}
            onClose={() => setOpenCloud(null)}
            onShowInSky={() => onShowCloudInSky(openCloud)}
          />
        )}
      </section>

      <DerelictPasses
        derelicts={catalogue?.derelicts ?? []}
        observer={observer}
        onSelectPass={onSelectPass}
        selectedPass={selectedPass}
      />

      <p className="text-[11px] text-space-400 leading-relaxed">
        Fragments are not loaded until you ask for them: the largest of these clouds is still thousands
        of objects, and a pass search over all of them would take longer than the request is allowed to
        live. Individual fragments are also, almost without exception, far
        too faint to see — a ten-centimetre piece of a solar panel is well past the naked-eye limit even
        directly overhead. The derelicts above are the part of this screen you can actually go outside
        and look at.
      </p>
    </div>
  );
}

/**
 * One derelict, with everything that makes it doubtful stated next to it.
 *
 * The two failure modes are different and both matter here: the elements may
 * be too old to predict from, and the object may be about to reenter. Neither
 * is unusual for this population, so neither is treated as an error.
 */
function DerelictRow({
  derelict,
  observer,
  displayTime,
  onLogSighting,
}: {
  derelict: ResolvedDerelict;
  observer: Observer;
  displayTime: Date;
  onLogSighting: (subject: string, satnum: string | null) => void;
}) {
  const [radio, setRadio] = useState<TransmitterResponse | null>(null);

  useEffect(() => {
    if (derelict.status !== 'resolved') return;
    let cancelled = false;
    fetchTransmitters(derelict.entry.satnum)
      .then((res) => !cancelled && setRadio(res))
      .catch(() => !cancelled && setRadio({ satnum: derelict.entry.satnum, transmitters: [], source: 'unavailable' }));
    return () => {
      cancelled = true;
    };
  }, [derelict]);

  const risk = useMemo(() => {
    if (!derelict.tle) return null;
    return assessRisk(derelict.tle, displayTime);
  }, [derelict.tle, displayTime]);

  if (derelict.status !== 'resolved') {
    return (
      <div className="px-4 py-3">
        <div className="text-sm text-space-300">
          {derelict.entry.label}
          <span className="ml-2 text-[11px] font-mono text-space-500">#{derelict.entry.satnum}</span>
        </div>
        <p className="text-[11px] text-amber-glow mt-0.5">
          {derelict.status === 'not-in-catalogue'
            ? 'No longer in the catalogue — this object has most likely reentered. That happens to things in this list, and is not an error.'
            : 'The catalogue could not be reached for this one, so it is unknown whether it is still up there.'}
        </p>
      </div>
    );
  }

  const alive = radio?.transmitters.filter((t) => t.alive) ?? [];
  const reach = derelict.tle ? preFilter([derelict.tle], observer) : null;
  const canRise = reach ? reach.candidates.length > 0 : false;

  return (
    <div className="px-4 py-3 flex flex-wrap items-start gap-x-4 gap-y-2">
      <div className="flex-1 min-w-[16rem]">
        <div className="text-sm font-medium text-space-100">
          {derelict.entry.label}
          <span className="ml-2 text-[11px] font-normal font-mono text-space-400">
            #{derelict.entry.satnum}
          </span>
          <span className="ml-2 text-[11px] font-normal text-space-400">
            {derelict.entry.kind === 'rocket-body' ? 'rocket body' : 'payload'}
          </span>
        </div>
        <p className="text-[11px] text-space-300 leading-relaxed mt-0.5">{derelict.entry.note}</p>

        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-[11px]">
          {risk && (
            <span className={FRESHNESS_STYLE[risk.freshness.level]}>
              elements {formatAge(risk.freshness.ageDays)}
            </span>
          )}
          {risk?.decay && (
            <span className="text-space-400 font-mono">
              {risk.decay.perigeeAltitudeKm.toFixed(0)}–{risk.decay.apogeeAltitudeKm.toFixed(0)} km
            </span>
          )}
          <span className={alive.length > 0 ? 'text-space-300' : 'text-space-500'}>
            {radio === null
              ? 'checking for a downlink…'
              : alive.length > 0
                ? `${alive.length} known downlink${alive.length === 1 ? '' : 's'}`
                : radio.source === 'unavailable'
                  ? 'downlink register unreachable'
                  : 'no known active downlink'}
          </span>
          {!canRise && (
            <span className="text-space-500">never rises at your latitude</span>
          )}
        </div>

        {risk?.summary && <p className="text-[11px] text-amber-glow mt-1">{risk.summary}</p>}
      </div>

      <button
        type="button"
        onClick={() => onLogSighting(derelict.entry.label, derelict.entry.satnum)}
        className="text-[11px] px-2 py-1 rounded border border-space-600 text-space-300 hover:border-glow-500 hover:text-glow-400 transition shrink-0"
      >
        I saw this
      </button>
    </div>
  );
}

/**
 * What a loaded cloud actually contains.
 *
 * Deliberately a population summary rather than a list of three thousand rows.
 * The fragments have no individual identity worth reading, and the pre-filter's
 * own arithmetic — how many can ever rise here, how many have already decayed
 * below anything usable — is the interesting part.
 */
function CloudDetail({
  data,
  observer,
  onClose,
  onShowInSky,
}: {
  data: DebrisCloudResponse;
  observer: Observer;
  onClose: () => void;
  onShowInSky: () => void;
}) {
  const filtered = useMemo(() => preFilter(data.tles, observer), [data.tles, observer]);
  const ages = useMemo(() => {
    const risks = data.tles.slice(0, 500).map((t) => assessRisk(t, new Date()));
    const counts = { fresh: 0, ageing: 0, stale: 0, unusable: 0 };
    for (const r of risks) counts[r.freshness.level] += 1;
    return { counts, sampled: risks.length };
  }, [data.tles]);

  const kept = filtered.candidates.length;
  const pct = data.count > 0 ? Math.round((kept / data.count) * 100) : 0;

  return (
    <div className="glass-panel rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-medium text-space-100">
            {data.cloud.label} — {data.count.toLocaleString()} still catalogued
          </h3>
          {/* The parent is identified from the fetched objects, so it is only
              claimed when it is actually there to point at. */}
          <p className="text-[11px] text-space-400 mt-0.5">
            {data.parent
              ? `The object itself is still up there: ${data.parent.name} (#${data.parent.satnum}).`
              : 'The object that broke up is no longer in this group — reentered, or never catalogued with its fragments.'}{' '}
            About {data.cloud.peakCatalogued.toLocaleString()} were catalogued at the peak.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* Shaded, never plotted. The button says region rather than "show
              fragments" because what appears is a density field, and a label
              promising objects would set the wrong expectation before the
              caveat is even read. */}
          <button
            type="button"
            onClick={onShowInSky}
            className="text-xs px-3 py-1.5 rounded-lg border transition"
            style={{ color: '#a78bfa', borderColor: 'rgba(167,139,250,0.4)', background: 'rgba(167,139,250,0.12)' }}
          >
            Shade this cloud in the sky
          </button>
          <button type="button" onClick={onClose} className="text-[11px] text-space-400 hover:text-space-200">
            Close
          </button>
        </div>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-sm">
        <Stat label="Could rise here">
          {kept.toLocaleString()}
          <span className="block text-[11px] text-space-400 font-sans">
            {pct}% of the cloud, from your latitude
          </span>
        </Stat>
        <Stat label="Never rises">
          {filtered.rejected['never-rises'].toLocaleString()}
          <span className="block text-[11px] text-space-400 font-sans">
            ground track too low in latitude
          </span>
        </Stat>
        <Stat label="Already decaying">
          {filtered.rejected['too-low'].toLocaleString()}
          <span className="block text-[11px] text-space-400 font-sans">perigee below 130 km</span>
        </Stat>
        <Stat label="Object types">
          {Object.entries(data.typeCounts)
            .map(([type, n]) => `${n} ${type.toLowerCase()}`)
            .join(', ') || '—'}
        </Stat>
      </dl>

      <div className="text-[11px] text-space-400 leading-relaxed">
        Element ages across a sample of {ages.sampled}: {ages.counts.fresh} current,{' '}
        {ages.counts.ageing} ageing, {ages.counts.stale} stale, {ages.counts.unusable} too old to predict
        from. Debris elements go off faster than a working satellite's, because drag is what SGP4
        extrapolates worst and these orbits are low.
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-space-400">{label}</dt>
      <dd className="text-sm font-mono text-space-100">{children}</dd>
    </div>
  );
}

/**
 * When the named derelicts are next visible.
 *
 * The identical pass search the rest of the app uses — same darkness windows,
 * same illumination test, same magnitude cutoff — simply handed a different
 * list of objects. Routed through the custom-TLE endpoint because these are
 * looked up individually rather than belonging to a tracked group, which also
 * means an object that has dropped out of the catalogue is already absent
 * rather than needing to be excluded here.
 */
function DerelictPasses({
  derelicts,
  observer,
  selectedPass,
  onSelectPass,
}: {
  derelicts: ResolvedDerelict[];
  observer: Observer;
  selectedPass: Pass | null;
  onSelectPass: (pass: Pass | null) => void;
}) {
  const [passes, setPasses] = useState<Pass[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ tooFaintCount: number; brightest: number | null } | null>(null);

  const tles = useMemo(
    () => derelicts.filter((d) => d.status === 'resolved' && d.tle).map((d) => d.tle!),
    [derelicts]
  );

  useEffect(() => {
    if (tles.length === 0) {
      setPasses([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCustomPasses(observer, tles, { days: 7 })
      .then((res) => {
        if (cancelled) return;
        setPasses(res.passes);
        setSummary({ tooFaintCount: res.tooFaintCount, brightest: res.brightestRejectedMagnitude });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not compute passes');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [observer, tles]);

  if (tles.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-lg font-medium text-space-100">When to look</h2>
        <p className="text-xs text-space-300">
          Next 7 days · the same pass search the rest of the app uses, over {tles.length} derelicts
        </p>
      </div>
      <PassTable
        passes={passes}
        loading={loading}
        error={error}
        selectedPass={selectedPass}
        onSelectPass={onSelectPass}
        tooFaintCount={summary?.tooFaintCount}
        brightestRejectedMagnitude={summary?.brightest ?? null}
        satelliteCount={tles.length}
      />
    </section>
  );
}
