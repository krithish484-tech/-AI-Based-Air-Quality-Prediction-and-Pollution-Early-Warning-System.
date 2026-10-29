# Air Quality System

A beginner-friendly air-quality dashboard for Indian cities and districts. Search works without an API key: the local server uses OpenStreetMap Nominatim to find a place and requests model estimates and a 24-hour forecast from Open-Meteo. These are clearly labelled **model estimates**, not ground-monitor observations. OpenAQ station observations are optional and require a server-side API key. No sample readings are generated.

## Requirements

- Node.js 18 or newer (includes npm and the built-in `fetch` API)
- An internet connection for location search, Open-Meteo model data, OpenStreetMap map tiles, and the Leaflet map library
- (Optional) An OpenAQ API key for monitoring-station observations

Node.js **is required**: the local backend in `server.mjs` runs on Node.js, and `npm start` uses npm. Install Node.js 18 or newer (prefer the current LTS release). The app has no npm package dependencies; you do **not** need to run `npm install`.

## Run on Windows

1. Install the current Node.js LTS release from [nodejs.org](https://nodejs.org/) if it is not already installed. Use the Windows installer and leave **Add to PATH** enabled. Close and reopen PowerShell after installation.
2. Verify Node.js and npm are available:

   ```powershell
   node --version
   npm --version
   ```

   `node --version` must report v18 or newer.
3. Open PowerShell in the project folder:

   ```powershell
   cd "C:\Users\krith\OneDrive\Microsoft Copilot Chat Files\Pictures\Documents\Desktop\AI-Air-Quality-System"
   ```

4. Start the dashboard. You do not need to create a `.env` file or obtain an API key for location search and Open-Meteo model estimates:

   ```powershell
   npm start
   ```

5. Open **http://localhost:3000** in your browser. Leave the PowerShell window running while you use the dashboard. Press **Ctrl+C** in that window to stop it.

### Optional: enable OpenAQ station observations

1. On your laptop, visit [explore.openaq.org/register](https://explore.openaq.org/register) and create an OpenAQ account.
2. Sign in and open [explore.openaq.org/account](https://explore.openaq.org/account) to view or create an API key. This step is optional; the app works without it.
3. In PowerShell, create the private settings file and open it:

   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```

4. Replace `your_openaq_api_key_here` in `.env` with your key, save the file, and restart `npm start`. Keep the key private; it is used only by the backend and `.env` is excluded by `.gitignore`.

OpenAQ documents the `X-API-Key` header and API rate limits. The server adds the key only to server-side OpenAQ requests; the browser never receives it.

If PowerShell says `node` or `npm` is not recognized, reopen PowerShell after installing Node.js and retry the version commands above. If a port is already in use, set another port in `.env`, for example `PORT=3001`, restart the server, and open `http://localhost:3001`.

If configured, the OpenAQ key stays in the server's `.env` file; browser code calls the local server proxy instead of receiving it. Change `.env` while the server is stopped, or restart the server after editing it.

Opening `public\index.html` directly, or using a temporary preview URL with no backend, is not enough: API requests and the district directory must be served by `server.mjs`. Open the URL printed by `npm start` (normally `http://localhost:3000`) rather than a `file://` path or an expired preview port.

## If the browser says "Failed to fetch"

1. Confirm that the PowerShell window running `npm start` is still open and shows `Air Quality System is running at http://localhost:3000`.
2. Open `http://localhost:3000/api/status` in the same browser. A JSON response with `"stationDataConfigured":false` means the server is reachable and the optional OpenAQ key is not set; model estimates and location search do not require that key. A browser `ERR_CONNECTION_REFUSED` or `Failed to fetch` for this same-origin URL usually means the local server is stopped or you opened the wrong port.
3. Model or location-provider errors are shown in the dashboard; retry after a brief wait if a public provider is temporarily unavailable. OpenAQ errors only affect station observations and do not turn model estimates into readings.
4. The website calls its own `/api/...` routes; an optional OpenAQ API key is added server-side. A browser-to-OpenAQ CORS error is not expected. Check the address bar origin and local server first.

## What is implemented

- Responsive dashboard layout: desktop has a location/warning sidebar, four summary cards, and map/chart panels side by side; tablet and mobile breakpoints reflow these panels without horizontal overflow. Light Mode uses a clean blue/red palette; Dark Mode uses deep navy with red-toned indicators.
- Search input with a local, alphabetized directory of 785 districts across 28 states and 8 union territories, plus an alphabetized state/UT selector. The selected state is included in the place lookup; the resolved place name and state are displayed, and a state mismatch raises a warning.
- Key-free, user-submitted place search through the Nominatim server proxy, with a 24-hour cache and at least 1.1 seconds between uncached requests. The common “Banglore” misspelling is normalized to Bengaluru before lookup.
- A key-free Open-Meteo CAMS global air-quality model connection for current PM2.5/PM10 estimates and a 24-hour PM2.5 forecast. Estimates, timestamps, provider, and attribution are labelled; model values are never listed as station measurements or used to generate station warnings.
- OpenAQ monitoring-station search and latest measurements when an optional server-side key is configured. Without it, the station table says **Live data unavailable** and explains how to enable measured readings.
- CPCB AQI remains unavailable unless the required pollutant data and official averaging periods are present.
- A server-side OpenAQ v3 API proxy. Search first resolves the submitted place through Nominatim (only after the user submits), then requests Indian OpenAQ monitoring locations within 25 km of the returned coordinates. It does not send unsupported city-name filters to OpenAQ.
- OpenAQ latest readings are matched to pollutant names and units using the sensor IDs and sensor metadata returned by OpenAQ's documented v3 schema.
- Measured pollutant concentrations, station name, available provider attribution, and observation timestamp, when returned by OpenAQ.
- Summary screening alerts use only observations with a verifiable timestamp from the last 24 hours. Older values remain labeled as stale and are excluded from warnings and the colored concentration markers.
- Screening comparisons also require a recognized microgram-per-cubic-metre unit. Missing or different units are displayed as supplied (or identified as missing) and are not compared to the PM2.5 thresholds.
- An interactive Leaflet/OpenStreetMap map initialized on page load, with an explicitly identified selected-place model-grid pin (not a station) and station markers when OpenAQ data is available. Monitoring-station marker bands describe PM2.5 concentration (below 30, 30–60, above 60 µg/m³), not AQI categories.
- A station comparison chart for recent, timestamped, unit-verified PM2.5 observations. It compares measured station values and does not invent hourly points or imply a forecast.
- A cautious PM2.5 screening notice. Values above 60 µg/m³ are compared with the CPCB 24-hour PM2.5 standard, with a clear warning that a single latest point does not establish a 24-hour average or a regulatory exceedance. Readings at or above 30 µg/m³ are separately identified as the dashboard's attention threshold.
- Clear loading, missing-key, no-station, and API-error messages. Missing measurements are never replaced with made-up values.
- `.env.example` and `.gitignore` protection for API keys.
- One-minute in-memory caching for OpenAQ requests, ten-minute caching for model responses, 24-hour caching for place lookups, and serial place lookups with at least 1.1 seconds between requests.

## Not implemented / data limitations

- **CPCB AQI:** calculated only from a single station's fresh, unit-verified measurements with explicit pollutant-specific averaging periods and data coverage. CPCB requires at least three pollutant sub-indices, including PM2.5 or PM10. OpenAQ latest records that omit averaging and coverage metadata are not eligible; the AQI card checks all nearby stations, prefers fresh particulate data, and summarizes the best available station's timestamp, unit, averaging-period, and coverage issues. Exact mg/m³↔µg/m³ conversions are supported; ppb/ppm gas conversions require measurement-specific temperature and pressure, and are not attempted unless supplied by the source. Model estimates are never used. CPCB's Severe concentration band is open-ended; when a concentration exceeds the last fixed breakpoint, the app does not invent a numeric sub-index.
- The Open-Meteo forecast is a CAMS atmospheric-composition **model estimate**, not a district-level sensor prediction or station observation. Its global model grid is approximately 45 km, so it may not reflect local street-level conditions. The free API permits educational, non-commercial use within its published call limits; Open-Meteo terms and CC BY 4.0 attribution apply.
- **Station coverage by district:** the administrative directory helps you select a place, but live observations are available only when OpenAQ has a monitoring station within 25 km of the geocoded place center. The 25 km radius is a search area, not a district boundary; check the displayed resolved location.
- OpenStreetMap's public Nominatim geocoder is intended for modest, user-submitted searches, not autocomplete or bulk geocoding. Requests are proxied, cached in memory, and rate-limited to at most one per 1.1 seconds. It requires OpenStreetMap attribution; the footer provides it. A replacement geocoder can be configured with `NOMINATIM_SEARCH_URL` in `.env`.
- Map tiles, place search, and model data require internet access and may be unavailable at some times. An API key does not guarantee that a district has a monitoring station or a recent observation.

## Data source and references

- Station observations: [OpenAQ API documentation](https://docs.openaq.org/)
- OpenAQ API key setup: [API key guide](https://docs.openaq.org/using-the-api/api-key)
- OpenAQ limits and attribution: [Rate limits](https://docs.openaq.org/using-the-api/rate-limits)
- Place geocoding: [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
- Model estimates and forecast: [Open-Meteo air-quality API](https://open-meteo.com/en/docs/air-quality-api), [terms of use](https://open-meteo.com/en/terms), and [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- State/district directory snapshot: [Yash Gaglani's Indian States and Districts list](https://github.com/Yash-Gaglani/List-of-States-and-Districts-in-India), described by its maintainer as based on Government of India-maintained data (2024 snapshot).
- Map data: [OpenStreetMap](https://www.openstreetmap.org/copyright)
- CPCB AQI categories, breakpoint concentrations, averaging periods, and sub-index method: [CPCB National AQI final report (PDF)](https://app.cpcbccr.com/ccr_docs/FINAL-REPORT_AQI_.pdf), [CPCB AQI page](https://cpcb.nic.in/air-quality-index/)
- The project reports pollutant concentrations as returned by OpenAQ. It does not independently certify the underlying instrument measurements.
- PM2.5 screening reference: CPCB National Ambient Air Quality Standards, PM2.5 24-hour standard of 60 µg/m³. The dashboard's 30 µg/m³ attention threshold is a project screening rule, not an official CPCB category or health determination.

## Integration verification

- The live Nominatim service successfully resolved an Adilabad, Telangana place lookup to Adilabad district, Telangana, India.
- The integration was checked against OpenAQ's live OpenAPI schema. Its documented location filters use `iso`, `coordinates`, and `radius`; latest observations refer to sensor IDs, which the dashboard maps to location sensor metadata.
- The full website was started with `npm start` (using a temporary Node.js 24 LTS runtime because Node was not installed on this machine), then tested at **http://localhost:3000** without an `.env` file or API key.
- The live `/api/search` route resolved Adilabad, Telangana and explicitly returned `stationDataConfigured: false` and zero stations; the separate `/api/air-quality` route returned real model data and 24 forecast points. The dashboard showed model-estimate labels and **Live data unavailable** for station observations.
- OpenStreetMap returned HTTP 200 for a real map tile, and the Leaflet map initialized with a selected-place pin, clearly identified as a model grid point rather than a station.
- Browser checks at 320, 375, 768, 1024, 1440, and 1680 px found no horizontal overflow. The desktop two-column dashboard and the tablet/mobile reflow were confirmed.
- An unauthenticated request to the real OpenAQ locations endpoint returned HTTP 401, confirming that a key is required for station observations. No key was supplied in this environment, so authenticated station results have **not** been tested here.
- Node.js was not installed system-wide; the temporary test runtime was kept outside the project and is removed after testing. Install Node.js using the Windows instructions above before running the server again.

## Troubleshooting

- **`node` or `npm` not recognized:** install Node.js 18+ with **Add to PATH** enabled, then close and reopen PowerShell.
- **No station observations:** OpenAQ requires a key; model estimates remain separate. To enable station observations, add `OPENAQ_API_KEY=your_actual_key` to `.env`. Do not commit or share that file.
- **No place or station found:** verify the geocoded place in the dashboard and try the district with its state or a nearby city. No results are not evidence of clean air.
- **Provider limit reached:** wait before searching again. Do not repeatedly retry a rejected key or rate-limit response.
- **Map is blank:** confirm internet access; OpenStreetMap tiles and Leaflet are loaded from their public services.
- **CPCB AQI not calculated:** OpenAQ must provide at least three eligible pollutants from one station (including PM2.5 or PM10), with supported units, fresh timestamps, the required averaging period, and sufficient coverage. OpenAQ's latest response may not include averaging metadata; in that case the app leaves AQI unavailable rather than treating a single point as an average.
