import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = resolve(root, "public");
const envPath = resolve(root, ".env");

if (existsSync(envPath)) {
  const envText = readFileSync(envPath, "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

const port = Number(process.env.PORT || 3000);
const openAqKey = process.env.OPENAQ_API_KEY;
const nominatimUrl = new URL(process.env.NOMINATIM_SEARCH_URL || "https://nominatim.openstreetmap.org/search");
if (nominatimUrl.protocol !== "https:") {
  throw new Error("NOMINATIM_SEARCH_URL must use HTTPS.");
}

const geocodeCache = new Map();
const geocodeInFlight = new Map();
const openAqCache = new Map();
const modelCache = new Map();
let lastGeocodeRequestAt = 0;
let geocodeQueue = Promise.resolve();
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function openAqRequest(path) {
  const cached = openAqCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  if (cached) openAqCache.delete(path);

  const response = await fetch(`https://api.openaq.org/v3${path}`, {
    headers: { "X-API-Key": openAqKey, Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    const detail = response.status === 401 || response.status === 403
      ? "OpenAQ rejected the API key. Check OPENAQ_API_KEY in your .env file."
      : response.status === 429
        ? "OpenAQ's free API limit was reached. Wait before searching again."
        : `OpenAQ returned HTTP ${response.status}. Please try again later.`;
    const error = new Error(detail);
    error.status = 502;
    error.code = response.status === 429 ? "UPSTREAM_RATE_LIMIT" : "UPSTREAM_ERROR";
    throw error;
  }

  const result = await response.json();
  if (openAqCache.size >= 300) openAqCache.delete(openAqCache.keys().next().value);
  openAqCache.set(path, { result, expiresAt: Date.now() + 60 * 1000 });
  return result;
}

async function airQualityModelRequest(latitude, longitude) {
  const cacheKey = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  const cached = modelCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  if (cached) modelCache.delete(cacheKey);

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "pm2_5,pm10",
    hourly: "pm2_5,pm10",
    forecast_days: "2",
    timezone: "GMT",
  });
  const response = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    const error = new Error(response.status === 429
      ? "The public air-quality model is busy. Please wait a moment and try again."
      : `The public air-quality model returned HTTP ${response.status}. Please try again later.`);
    error.status = 502;
    error.code = response.status === 429 ? "MODEL_RATE_LIMIT" : "MODEL_ERROR";
    throw error;
  }

  const data = await response.json();
  const current = data.current || {};
  const hourly = data.hourly || {};
  const currentTime = typeof current.time === "string" && !current.time.endsWith("Z")
    ? `${current.time}Z`
    : current.time || null;
  const now = Date.now();
  const cutoff = now + 24 * 60 * 60 * 1000;
  const forecast = (Array.isArray(hourly.time) ? hourly.time : [])
    .map((time, index) => ({
      time: typeof time === "string" ? (time.endsWith("Z") ? time : `${time}Z`) : "",
      pm25: Array.isArray(hourly.pm2_5) ? hourly.pm2_5[index] : null,
      pm10: Array.isArray(hourly.pm10) ? hourly.pm10[index] : null,
    }))
    .filter((point) => {
      const timestamp = Date.parse(point.time);
      return Number.isFinite(timestamp) &&
        timestamp >= now - 60 * 60 * 1000 &&
        timestamp <= cutoff &&
        Number.isFinite(point.pm25) && point.pm25 >= 0;
    })
    .slice(0, 24);
  const result = {
    provider: "Open-Meteo",
    model: "CAMS global atmospheric composition model",
    attribution: "Air-quality model data by Open-Meteo, licensed under CC BY 4.0",
    current: {
      time: currentTime || null,
      pm25: Number.isFinite(current.pm2_5) && current.pm2_5 >= 0 ? current.pm2_5 : null,
      pm10: Number.isFinite(current.pm10) && current.pm10 >= 0 ? current.pm10 : null,
    },
    units: {
      pm25: data.current_units?.pm2_5 || "µg/m³",
      pm10: data.current_units?.pm10 || "µg/m³",
    },
    hourly: forecast,
  };
  if (modelCache.size >= 200) modelCache.delete(modelCache.keys().next().value);
  modelCache.set(cacheKey, { result, expiresAt: Date.now() + 10 * 60 * 1000 });
  return result;
}

async function geocodeIndianLocation(query) {
  const normalizedQuery = query.replace(/\bbanglore\b/gi, "Bengaluru");
  const cacheKey = normalizedQuery.toLocaleLowerCase("en-IN");
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  if (cached) geocodeCache.delete(cacheKey);
  if (geocodeInFlight.has(cacheKey)) return geocodeInFlight.get(cacheKey);

  const params = new URLSearchParams({
    q: `${normalizedQuery}, India`,
    format: "jsonv2",
    addressdetails: "1",
    countrycodes: "in",
    limit: "1",
  });

  const request = geocodeQueue.then(async () => {
    const delay = Math.max(0, 1100 - (Date.now() - lastGeocodeRequestAt));
    if (delay) await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
    lastGeocodeRequestAt = Date.now();

    const response = await fetch(`${nominatimUrl}?${params}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "AirQualitySystem/1.0 (educational air-quality dashboard)",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      const error = new Error(response.status === 429
        ? "The location search service is busy. Please wait a moment and try again."
        : `The location search service returned HTTP ${response.status}. Please try again later.`);
      error.status = 502;
      error.code = response.status === 429 ? "GEOCODER_RATE_LIMIT" : "GEOCODER_ERROR";
      throw error;
    }

    const results = await response.json();
    const match = Array.isArray(results) ? results[0] : null;
    const latitude = match ? Number(match.lat) : NaN;
    const longitude = match ? Number(match.lon) : NaN;
    if (!match || match.address?.country_code?.toLowerCase() !== "in" ||
        !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    const address = match.address;
    const district = address.state_district || address.city_district ||
      address.county || address.city || address.town || address.village || "";
    const state = address.state || "";
    return {
      latitude,
      longitude,
      district,
      state,
      label: [district, state].filter(Boolean).join(", ") || match.display_name,
    };
  });

  geocodeQueue = request.then(() => undefined, () => undefined);
  geocodeInFlight.set(cacheKey, request);
  try {
    const result = await request;
    if (geocodeCache.size >= 200) geocodeCache.delete(geocodeCache.keys().next().value);
    geocodeCache.set(cacheKey, { result, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
    return result;
  } finally {
    geocodeInFlight.delete(cacheKey);
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function handleApi(url, response) {
  if (url.pathname === "/api/status") {
    const configured = Boolean(openAqKey && openAqKey !== "your_openaq_api_key_here");
    sendJson(response, 200, {
      stationDataConfigured: configured,
      stationProvider: "OpenAQ",
      modelProvider: "Open-Meteo",
    });
    return;
  }

  if (url.pathname === "/api/air-quality") {
    const latitude = Number(url.searchParams.get("latitude"));
    const longitude = Number(url.searchParams.get("longitude"));
    if (!Number.isFinite(latitude) || latitude < 6 || latitude > 38.7 ||
        !Number.isFinite(longitude) || longitude < 68 || longitude > 97.5) {
      sendJson(response, 400, { error: "A valid latitude and longitude in India are required." });
      return;
    }

    try {
      sendJson(response, 200, await airQualityModelRequest(latitude, longitude));
    } catch (error) {
      console.error("Public air-quality model request failed:", error.message);
      sendJson(response, error.status || 502, {
        error: error.name === "TimeoutError"
          ? "The public air-quality model took too long to respond. Please try again."
          : error.message || "The public air-quality model could not be reached.",
        code: error.name === "TimeoutError" ? "UPSTREAM_TIMEOUT" : error.code || "MODEL_ERROR",
      });
    }
    return;
  }

  const isSearch = url.pathname === "/api/search";
  const latestMatch = url.pathname.match(/^\/api\/locations\/(\d+)\/latest$/);
  if (!isSearch && !latestMatch) {
    sendJson(response, 404, { error: "API route not found." });
    return;
  }
  const stationDataConfigured = Boolean(openAqKey && openAqKey !== "your_openaq_api_key_here");
  if (latestMatch && !stationDataConfigured) {
    sendJson(response, 503, {
      error: "Live station data is unavailable. Add an OpenAQ API key to the server's .env file to enable observations.",
      code: "API_KEY_MISSING",
    });
    return;
  }

  try {
    if (isSearch) {
      const query = (url.searchParams.get("q") || "").trim();
      if (query.length < 2 || query.length > 160) {
        sendJson(response, 400, { error: "Enter a location name with 2 to 160 characters." });
        return;
      }

      const geocoded = await geocodeIndianLocation(query);
      if (!geocoded) {
        sendJson(response, 404, {
          error: `No Indian place match was found for "${query}". Try a district, city, or district and state.`,
          code: "LOCATION_NOT_FOUND",
        });
        return;
      }

      let locations = [];
      if (stationDataConfigured) {
        const parameters = new URLSearchParams({
          iso: "IN",
          coordinates: `${geocoded.latitude},${geocoded.longitude}`,
          radius: "25000",
          limit: "20",
          page: "1",
        });
        const data = await openAqRequest(`/locations?${parameters}`);
        locations = (Array.isArray(data.results) ? data.results : [])
          .filter((item) => Number.isSafeInteger(item.id) &&
            Number.isFinite(item.coordinates?.latitude) &&
            Number.isFinite(item.coordinates?.longitude))
          .map((item) => ({
            id: item.id,
            name: item.name || `OpenAQ station ${item.id}`,
            locality: item.locality || "",
            city: "",
            country: item.country?.name || "India",
            coordinates: item.coordinates,
            distanceMeters: Number.isFinite(item.distance) ? item.distance : null,
            provider: item.provider ? { name: item.provider.name || "" } : null,
            owner: item.owner ? { name: item.owner.name || "" } : null,
            sensors: (Array.isArray(item.sensors) ? item.sensors : [])
              .filter((sensor) => Number.isSafeInteger(sensor.id))
              .map((sensor) => ({
                id: sensor.id,
                parameter: sensor.parameter?.name || "",
                unit: sensor.parameter?.units || "",
                name: sensor.name || "",
              })),
            instruments: item.instruments || [],
          }))
          .sort((a, b) => (a.distanceMeters ?? Number.MAX_SAFE_INTEGER) -
            (b.distanceMeters ?? Number.MAX_SAFE_INTEGER));
      }

      sendJson(response, 200, {
        location: geocoded,
        radiusMeters: 25000,
        stationDataConfigured,
        results: locations,
      });
      return;
    }

    if (latestMatch) {
      const data = await openAqRequest(`/locations/${latestMatch[1]}/latest`);
      const results = (Array.isArray(data.results) ? data.results : [])
        .filter((item) => Number.isSafeInteger(item.sensorsId) &&
          Number.isFinite(item.value) && item.value >= 0)
        .map((item) => ({
          sensorId: item.sensorsId,
          value: item.value,
          datetime: item.datetime?.utc || item.datetime?.local || null,
          period: item.period || null,
          coverage: item.coverage || null,
          conditions: item.conditions || null,
        }))
        .sort((a, b) => (b.datetime || "").localeCompare(a.datetime || ""));
      sendJson(response, 200, { results });
      return;
    }

    sendJson(response, 404, { error: "API route not found." });
  } catch (error) {
    console.error("Data provider request failed:", error.message);
    sendJson(response, error.status || 502, {
      error: error.name === "TimeoutError"
        ? "A data provider took too long to respond. Please try again."
        : error.message || "The air-quality provider could not be reached.",
      code: error.name === "TimeoutError" ? "UPSTREAM_TIMEOUT" : error.code || "UPSTREAM_ERROR",
    });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(url, response);
    return;
  }

  let requestedPath;
  try {
    requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Invalid request path");
    return;
  }
  const filePath = resolve(publicRoot, `.${requestedPath}`);
  if (filePath !== publicRoot && !filePath.startsWith(publicRoot + sep)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    if (!statSync(filePath).isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    const stream = createReadStream(filePath);
    stream.on("error", (error) => {
      console.error("Static file stream failed:", error.message);
      response.destroy(error);
    });
    stream.pipe(response);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    console.error("Static file request failed:", error.message);
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Could not read the requested file.");
  }
});

server.listen(port, () => {
  console.log(`Air Quality System is running at http://localhost:${port}`);
  if (!openAqKey || openAqKey === "your_openaq_api_key_here") {
    console.info("OpenAQ station observations are disabled. The public Open-Meteo model does not require an API key.");
  }
});
