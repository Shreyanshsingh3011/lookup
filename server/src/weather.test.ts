import assert from "node:assert/strict";
import { test } from "node:test";
import { cloudCoverAt, cloudLabel, hourKey, parseCloudForecast } from "./weather.js";

/**
 * A genuine response, captured 2026-07-30 from:
 *
 *   https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=0.0&hourly=cloud_cover&forecast_days=2&timezone=UTC
 *
 * The API was unreachable from the environment this module was originally
 * built in, so the first version of this fixture was written from Open-Meteo's
 * documentation rather than a real response. This replaces it with an actual
 * captured payload, fetched by hand and pasted in. It parses identically to
 * the documentation-derived version — including the one surprise, noted below.
 */
const OPEN_METEO_RESPONSE = {
  latitude: 51.5,
  longitude: 0.0,
  generationtime_ms: 0.04398822784423828,
  utc_offset_seconds: 0,
  // Requesting timezone=UTC gets back "GMT" here, not "UTC" — Open-Meteo's
  // naming, not ours. parseCloudForecast never reads this field, only
  // hourly.time/cloud_cover, so it makes no difference either way.
  timezone: "GMT",
  timezone_abbreviation: "GMT",
  elevation: 4.0,
  hourly_units: { time: "iso8601", cloud_cover: "%" },
  hourly: {
    time: [
      "2026-07-30T00:00", "2026-07-30T01:00", "2026-07-30T02:00", "2026-07-30T03:00",
      "2026-07-30T04:00", "2026-07-30T05:00", "2026-07-30T06:00", "2026-07-30T07:00",
      "2026-07-30T08:00", "2026-07-30T09:00", "2026-07-30T10:00", "2026-07-30T11:00",
      "2026-07-30T12:00", "2026-07-30T13:00", "2026-07-30T14:00", "2026-07-30T15:00",
      "2026-07-30T16:00", "2026-07-30T17:00", "2026-07-30T18:00", "2026-07-30T19:00",
      "2026-07-30T20:00", "2026-07-30T21:00", "2026-07-30T22:00", "2026-07-30T23:00",
      "2026-07-31T00:00", "2026-07-31T01:00", "2026-07-31T02:00", "2026-07-31T03:00",
      "2026-07-31T04:00", "2026-07-31T05:00", "2026-07-31T06:00", "2026-07-31T07:00",
      "2026-07-31T08:00", "2026-07-31T09:00", "2026-07-31T10:00", "2026-07-31T11:00",
      "2026-07-31T12:00", "2026-07-31T13:00", "2026-07-31T14:00", "2026-07-31T15:00",
      "2026-07-31T16:00", "2026-07-31T17:00", "2026-07-31T18:00", "2026-07-31T19:00",
      "2026-07-31T20:00", "2026-07-31T21:00", "2026-07-31T22:00", "2026-07-31T23:00",
    ],
    cloud_cover: [
      0, 0, 0, 0, 100, 100, 100, 20, 24, 48, 91, 63, 98, 75, 100, 100,
      100, 100, 80, 97, 100, 98, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100,
      97, 81, 40, 39, 13, 8, 14, 30, 52, 56, 66, 61, 2, 8, 0, 0,
    ],
  },
};

test("parses a genuine captured Open-Meteo response", () => {
  const forecast = parseCloudForecast(OPEN_METEO_RESPONSE, 51.4769, -0.0005);
  assert.equal(forecast.hourly.size, 48);
  assert.equal(forecast.hourly.get("2026-07-30T00"), 0);
  assert.equal(forecast.hourly.get("2026-07-30T12"), 98);
  assert.equal(forecast.hourly.get("2026-07-31T23"), 0);
  // The requested coordinates are kept, not the grid cell Open-Meteo snapped to.
  assert.equal(forecast.latitude, 51.4769);
});

test("skips null gaps without discarding the forecast", () => {
  const withGap = {
    hourly: {
      time: ["2026-07-29T20:00", "2026-07-29T21:00", "2026-07-29T22:00"],
      cloud_cover: [10, null, 30],
    },
  };
  const forecast = parseCloudForecast(withGap, 0, 0);
  assert.equal(forecast.hourly.size, 2);
  assert.equal(forecast.hourly.get("2026-07-29T21"), undefined);
  assert.equal(forecast.hourly.get("2026-07-29T22"), 30);
});

test("clamps out-of-range percentages", () => {
  const odd = {
    hourly: { time: ["2026-07-29T20:00", "2026-07-29T21:00"], cloud_cover: [-5, 140] },
  };
  const forecast = parseCloudForecast(odd, 0, 0);
  assert.equal(forecast.hourly.get("2026-07-29T20"), 0);
  assert.equal(forecast.hourly.get("2026-07-29T21"), 100);
});

test("rejects a response whose shape does not match the contract", () => {
  assert.throws(() => parseCloudForecast(null, 0, 0), /not an object/);
  assert.throws(() => parseCloudForecast({}, 0, 0), /no 'hourly' block/);
  assert.throws(() => parseCloudForecast({ hourly: {} }, 0, 0), /time\/cloud_cover arrays/);
  assert.throws(
    () => parseCloudForecast({ hourly: { time: ["a", "b"], cloud_cover: [1] } }, 0, 0),
    /2 timestamps but 1 cloud-cover/
  );
  assert.throws(
    () => parseCloudForecast({ hourly: { time: [], cloud_cover: [] } }, 0, 0),
    /empty forecast/
  );
  assert.throws(
    () => parseCloudForecast({ hourly: { time: ["a"], cloud_cover: ["nope"] } }, 0, 0),
    /no usable cloud-cover values/
  );
});

test("cloudCoverAt rounds to the nearest hour", () => {
  const forecast = parseCloudForecast(OPEN_METEO_RESPONSE, 0, 0);
  // 12:20 is nearer 12:00 (98%); 12:40 is nearer 13:00 (75%).
  assert.equal(cloudCoverAt(forecast, new Date("2026-07-30T12:20:00Z")), 98);
  assert.equal(cloudCoverAt(forecast, new Date("2026-07-30T12:40:00Z")), 75);
});

test("cloudCoverAt returns null outside the forecast window", () => {
  const forecast = parseCloudForecast(OPEN_METEO_RESPONSE, 0, 0);
  // Passes are predicted 10 days out and can run past the forecast horizon.
  assert.equal(cloudCoverAt(forecast, new Date("2026-08-15T21:00:00Z")), null);
  assert.equal(cloudCoverAt(null, new Date("2026-07-30T21:00:00Z")), null);
});

test("hourKey formats a UTC hour", () => {
  assert.equal(hourKey(new Date("2026-07-29T21:00:00Z")), "2026-07-29T21");
});

test("cloudLabel bands the percentage", () => {
  assert.equal(cloudLabel(0), "clear");
  assert.equal(cloudLabel(15), "clear");
  assert.equal(cloudLabel(50), "partly cloudy");
  assert.equal(cloudLabel(85), "mostly cloudy");
  assert.equal(cloudLabel(100), "overcast");
});
