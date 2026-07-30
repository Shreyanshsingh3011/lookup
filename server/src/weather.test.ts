import assert from "node:assert/strict";
import { test } from "node:test";
import { cloudCoverAt, cloudLabel, hourKey, parseCloudForecast } from "./weather.js";

/**
 * Open-Meteo's documented response for
 * `?hourly=cloud_cover&timezone=UTC`, trimmed to a few hours.
 *
 * This fixture pins the upstream contract. It was written from Open-Meteo's
 * documentation rather than a captured live response, because the API is not
 * reachable from the environment this was built in — so if the real shape
 * differs, `parseCloudForecast` throws with a specific message and these tests
 * are where to look.
 */
const OPEN_METEO_RESPONSE = {
  latitude: 51.5,
  longitude: 0.0,
  generationtime_ms: 0.084,
  utc_offset_seconds: 0,
  timezone: "UTC",
  timezone_abbreviation: "UTC",
  elevation: 23.0,
  hourly_units: { time: "iso8601", cloud_cover: "%" },
  hourly: {
    time: [
      "2026-07-29T20:00",
      "2026-07-29T21:00",
      "2026-07-29T22:00",
      "2026-07-29T23:00",
    ],
    cloud_cover: [8, 42, 91, 100],
  },
};

test("parses the documented Open-Meteo response", () => {
  const forecast = parseCloudForecast(OPEN_METEO_RESPONSE, 51.4769, -0.0005);
  assert.equal(forecast.hourly.size, 4);
  assert.equal(forecast.hourly.get("2026-07-29T20"), 8);
  assert.equal(forecast.hourly.get("2026-07-29T23"), 100);
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
  // 20:55 is nearer 21:00, so it should read 42 rather than 20:00's 8.
  assert.equal(cloudCoverAt(forecast, new Date("2026-07-29T20:55:00Z")), 42);
  assert.equal(cloudCoverAt(forecast, new Date("2026-07-29T20:20:00Z")), 8);
});

test("cloudCoverAt returns null outside the forecast window", () => {
  const forecast = parseCloudForecast(OPEN_METEO_RESPONSE, 0, 0);
  // Passes are predicted 10 days out and can run past the forecast horizon.
  assert.equal(cloudCoverAt(forecast, new Date("2026-08-15T21:00:00Z")), null);
  assert.equal(cloudCoverAt(null, new Date("2026-07-29T21:00:00Z")), null);
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
