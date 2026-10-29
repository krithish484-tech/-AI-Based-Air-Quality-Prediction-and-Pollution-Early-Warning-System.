const form = document.getElementById("search-form");
const locationInput = document.getElementById("location");
const statusEl = document.getElementById("status");
const selectedLocationEl = document.getElementById("selected-location");
const forecastBody = document.getElementById("forecast-body");
const stationsEl = document.getElementById("stations");

const pm25Value = document.getElementById("pm25-value");
const pm10Value = document.getElementById("pm10-value");
const pm25Unit = document.getElementById("pm25-unit");
const pm10Unit = document.getElementById("pm10-unit");
const updatedValue = document.getElementById("updated-value");
const sourceValue = document.getElementById("source-value");

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

function formatValue(value, fallback = "—") {
  return Number.isFinite(value) ? value.toFixed(1) : fallback;
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function renderForecast(hours) {
  if (!Array.isArray(hours) || !hours.length) {
    forecastBody.innerHTML = '<tr><td colspan="3">No forecast data yet.</td></tr>';
    return;
  }

  forecastBody.innerHTML = hours
    .slice(0, 12)
    .map((entry) => {
      const timeLabel = formatDateTime(entry.time);
      const pm25 = Number.isFinite(entry.pm25) ? entry.pm25.toFixed(1) : "—";
      const pm10 = Number.isFinite(entry.pm10) ? entry.pm10.toFixed(1) : "—";
      return `
        <tr>
          <td>${timeLabel}</td>
          <td>${pm25}</td>
          <td>${pm10}</td>
        </tr>
      `;
    })
    .join("");
}

function renderStations(results) {
  if (!Array.isArray(results) || !results.length) {
    stationsEl.innerHTML = "<p>No monitoring stations were found for this location.</p>";
    return;
  }

  stationsEl.innerHTML = results
    .slice(0, 8)
    .map((station) => {
      const name = station.name || "Unknown station";
      const locality = station.locality || "";
      const sensors = Array.isArray(station.sensors) ? station.sensors : [];
      const sensorSummary = sensors.length
        ? sensors.map((sensor) => `${sensor.parameter || "Pollutant"}: ${sensor.unit || "µg/m³"}`).slice(0, 3).join(" • ")
        : "No sensor metadata";
      return `
        <article class="station-item">
          <strong>${name}</strong>
          <small>${locality || "OpenAQ station"}</small>
          <div>${sensorSummary}</div>
        </article>
      `;
    })
    .join("");
}

async function loadAirQuality(latitude, longitude) {
  const response = await fetch(`/api/air-quality?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Could not load air-quality data.");
  }

  return response.json();
}

async function searchLocation(query) {
  const trimmed = query.trim();
  if (!trimmed) {
    setStatus("Enter a city or district name in India.", "error");
    return;
  }

  setStatus("Searching for the location…");

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
    const payload = await response.json();

    if (!response.ok || !payload.location) {
      throw new Error(payload.error || "No matching Indian location was found.");
    }

    const { location, results = [] } = payload;
    selectedLocationEl.textContent = location.label || `${location.district || "Location"}, ${location.state || "India"}`;
    renderStations(results);

    const modelData = await loadAirQuality(location.latitude, location.longitude);

    const current = modelData.current || {};
    const latestPm25 = Number.isFinite(current.pm25) ? current.pm25 : null;
    const latestPm10 = Number.isFinite(current.pm10) ? current.pm10 : null;

    pm25Value.textContent = latestPm25 === null ? "—" : formatValue(latestPm25);
    pm10Value.textContent = latestPm10 === null ? "—" : formatValue(latestPm10);
    pm25Unit.textContent = modelData.units?.pm25 || "µg/m³";
    pm10Unit.textContent = modelData.units?.pm10 || "µg/m³";
    updatedValue.textContent = current.time ? formatDateTime(current.time) : "—";
    sourceValue.textContent = modelData.provider || "Open-Meteo";

    renderForecast(modelData.hourly || []);
    setStatus(`Loaded air-quality data for ${selectedLocationEl.textContent}.`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  searchLocation(locationInput.value);
});

searchLocation(locationInput.value);
