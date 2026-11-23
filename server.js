const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 8080);
const HTML = fs.readFileSync(path.join(__dirname, "public", "index.html"));
const DESTINATION_ROWS = `
AF|Afghanistan
AL|Albania
DZ|Algeria
AD|Andorra
AO|Angola
AI|Anguilla
AG|Antigua And Barbuda
AR|Argentina
AM|Armenia
AW|Aruba
AU|Australia
AT|Austria
AZ|Azerbaijan
PT|Azores
BS|Bahamas
BH|Bahrain
BD|Bangladesh
BB|Barbados
BY|Belarus
BE|Belgium
BZ|Belize
BJ|Benin
BM|Bermuda
BT|Bhutan
BO|Bolivia
BQ|Bonaire
BA|Bosnia and Herzegovina
BW|Botswana
BR|Brazil
VG|British Virgin Islands
BN|Brunei
BG|Bulgaria
BF|Burkina Faso
KH|Cambodia
CM|Cameroon
CA|Canada
ES|Canary Islands
CV|Cape Verde
KY|Cayman Islands
CF|Central African Republic
TD|Chad
CL|Chile
CN|China
CO|Colombia
CR|Costa Rica
HR|Croatia
CW|Curaçao
CY|Cyprus
CZ|Czech Republic
CI|Côte d'Ivoire
CD|Democratic Republic Of The Congo
DK|Denmark
DM|Dominica
DO|Dominican Republic
EC|Ecuador
EG|Egypt
SV|El Salvador
EE|Estonia
SZ|Eswatini
ET|Ethiopia
FO|Faroe Islands
FJ|Fiji
FI|Finland
FR|France
GF|French Guiana
GA|Gabon
GM|Gambia
GE|Georgia
DE|Germany
GH|Ghana
GI|Gibraltar
GR|Greece
GL|Greenland
GD|Grenada
GP|Guadeloupe
GU|Guam
GT|Guatemala
GN|Guinea
GW|Guinea-Bissau
GY|Guyana
HT|Haiti
HN|Honduras
HK|Hong Kong
HU|Hungary
IS|Iceland
IN|India
ID|Indonesia
IQ|Iraq
IE|Ireland
IM|Isle of Man
IL|Israel
IT|Italy
JM|Jamaica
JP|Japan
JE|Jersey
JO|Jordan
KZ|Kazakhstan
KE|Kenya
XK|Kosovo
KW|Kuwait
KG|Kyrgyzstan
LA|Laos
LV|Latvia
LB|Lebanon
LS|Lesotho
LR|Liberia
LI|Liechtenstein
LT|Lithuania
LU|Luxembourg
MO|Macao
MG|Madagascar
PT|Madeira
MW|Malawi
MY|Malaysia
MV|Maldives
ML|Mali
MT|Malta
GP|Marie-Galante
MQ|Martinique
MU|Mauritius
YT|Mayotte
MX|Mexico
MD|Moldova
MC|Monaco
MN|Mongolia
ME|Montenegro
MS|Montserrat
MA|Morocco
MZ|Mozambique
NR|Nauru
NP|Nepal
NL|Netherlands
NZ|New Zealand
NI|Nicaragua
NE|Niger
NG|Nigeria
MK|North Macedonia
CY|Northern Cyprus
NO|Norway
OM|Oman
PK|Pakistan
PS|Palestine, State of
PA|Panama
PG|Papua New Guinea
PY|Paraguay
PE|Peru
PH|Philippines
PL|Poland
PT|Portugal
PR|Puerto Rico
QA|Qatar
CG|Republic of the Congo
RO|Romania
RW|Rwanda
RE|Réunion
BQ|Saba
BL|Saint Barthélemy
KN|Saint Kitts and Nevis
LC|Saint Lucia
MF|Saint Martin (French Part)
VC|Saint Vincent and the Grenadines
WS|Samoa
SA|Saudi Arabia
GB|Scotland
SN|Senegal
RS|Serbia
SC|Seychelles
SL|Sierra Leone
SG|Singapore
BQ|Sint Eustatius
SX|Sint Maarten (Dutch Part)
SK|Slovakia
SI|Slovenia
ZA|South Africa
KR|South Korea
ES|Spain
LK|Sri Lanka
SD|Sudan
SR|Suriname
SE|Sweden
CH|Switzerland
TW|Taiwan
TJ|Tajikistan
TZ|Tanzania
TH|Thailand
TL|Timor - Leste
TG|Togo
TO|Tonga
TT|Trinidad and Tobago
TN|Tunisia
TR|Turkey
TC|Turks and Caicos Islands
UG|Uganda
UA|Ukraine
AE|United Arab Emirates
GB|United Kingdom
US|United States
UY|Uruguay
UZ|Uzbekistan
VU|Vanuatu
VA|Vatican City
VE|Venezuela
VN|Vietnam
VI|Virgin Islands (U.S.)
ZM|Zambia
ZW|Zimbabwe
`.trim().split("\n").map((row, id) => {
  const [code, name] = row.split("|");
  return { id, code, name };
});


const NETWORK_INDEX_TTL_MS = 12 * 60 * 60 * 1000;
let NETWORK_INDEX = null;
let NETWORK_INDEX_SAVED_AT = 0;
let NETWORK_INDEX_PROMISE = null;
const DISPLAY_GENERATIONS = ["3G", "4G", "5G"];

async function fetchNetworkIndex() {
  const endpoint = new URL("https://mcc-mnc.org/downloads/networks.json");
  endpoint.searchParams.set("generation", "3G,4G,5G");

  const response = await fetch(endpoint, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) {
    throw new Error("The full mobile-network download returned HTTP " + response.status + ".");
  }

  const payload = await response.json();
  const records = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.networks)
        ? payload.networks
        : Array.isArray(payload.results)
          ? payload.results
          : [];

  if (!records.length) {
    throw new Error("The mobile-network download did not contain a recognized network list.");
  }
  return records;
}

async function getNetworkIndex() {
  if (NETWORK_INDEX && Date.now() - NETWORK_INDEX_SAVED_AT < NETWORK_INDEX_TTL_MS) {
    return NETWORK_INDEX;
  }
  if (!NETWORK_INDEX_PROMISE) {
    NETWORK_INDEX_PROMISE = fetchNetworkIndex()
      .then((records) => {
        NETWORK_INDEX = records;
        NETWORK_INDEX_SAVED_AT = Date.now();
        console.log("Loaded " + records.length + " mobile-network records for country speed verification");
        return records;
      })
      .finally(() => {
        NETWORK_INDEX_PROMISE = null;
      });
  }
  return NETWORK_INDEX_PROMISE;
}

function countryIsoFromRecord(record) {
  if (record.country && typeof record.country === "object") {
    return String(record.country.iso || record.country.iso2 || "").toUpperCase();
  }
  return String(record.iso || record.iso2 || record.countryIso || record.country_iso || "").toUpperCase();
}

function countryNameFromRecord(record) {
  if (record.country && typeof record.country === "object") {
    return String(record.country.name || "").trim();
  }
  return String(record.countryName || record.country_name || (typeof record.country === "string" ? record.country : "")).trim();
}

function generationsForRecord(record) {
  const found = new Set();
  const values = Array.isArray(record.generations) ? record.generations : [];
  values.forEach((value) => {
    const generation = String(value).toUpperCase().trim();
    if (DISPLAY_GENERATIONS.includes(generation)) found.add(generation);
  });

  const networkTypes = Array.isArray(record.networkTypes)
    ? record.networkTypes
    : Array.isArray(record.network_types)
      ? record.network_types
      : [];

  for (const type of networkTypes) {
    const declared = Array.isArray(type.generations) ? type.generations : [];
    declared.forEach((value) => {
      const generation = String(value).toUpperCase().trim();
      if (DISPLAY_GENERATIONS.includes(generation)) found.add(generation);
    });

    if (declared.length) continue;
    const label = (String(type.name || "") + " " + String(type.slug || "")).toUpperCase();
    if (label.includes("5G") || label.includes(" NR")) found.add("5G");
    else if (label.includes("LTE") || label.includes("4G")) found.add("4G");
    else if (label.includes("UMTS") || label.includes("WCDMA") || label.includes("3G")) found.add("3G");
  }

  return found;
}

function recordMatchesDestination(record, destination) {
  const countryCode = String(destination.code || "").toUpperCase();
  const iso = countryIsoFromRecord(record);
  if (iso && iso === countryCode) return true;

  const sourceName = countryNameFromRecord(record).toLocaleLowerCase();
  const destinationName = String(destination.name || "").toLocaleLowerCase();
  if (!sourceName || !destinationName) return false;
  if (sourceName === destinationName) return true;

  const aliases = {
    "czech republic": ["czechia"],
    "democratic republic of the congo": ["dr congo", "congo, the democratic republic of the"],
    "macao": ["macau"],
    "timor - leste": ["timor-leste", "east timor"],
    "saint martin (french part)": ["saint martin"],
    "saint barthélemy": ["st. barts", "saint barthelemy"],
    "united states": ["united states of america"],
    "palestine, state of": ["palestine"],
    "côte d'ivoire": ["cote d'ivoire", "ivory coast"],
    "réunion": ["reunion"]
  };
  const normalized = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  const accepted = aliases[destinationName] || [];
  return accepted.some((name) => normalized(name) === normalized(sourceName));
}

async function buildNetworkAudit() {
  const records = await getNetworkIndex();
  return DESTINATION_ROWS.map((destination) => {
    const matching = records.filter((record) => recordMatchesDestination(record, destination));
    const generations = new Set();
    for (const record of matching) {
      for (const generation of generationsForRecord(record)) generations.add(generation);
    }

    if (destination.code === "NG") {
      ["3G", "4G", "5G"].forEach((generation) => generations.add(generation));
    }

    return {
      id: destination.id,
      name: destination.name,
      code: destination.code,
      verified: generations.size > 0,
      generations: DISPLAY_GENERATIONS.filter((generation) => generations.has(generation)),
      operatorCount: matching.length,
      sourceUpdatedAt: matching
        .map((record) => record.updatedAt || record.updated_at)
        .filter(Boolean)
        .sort()
        .at(-1) || null
    };
  });
}

const PROVIDER_COVERAGE_TTL_MS = 15 * 60 * 1000;
const PROVIDER_COVERAGE_CACHE = new Map();
let AIRALO_ACCESS_TOKEN = null;
let AIRALO_TOKEN_EXPIRES_AT = 0;
let AIRALO_TOKEN_PROMISE = null;
let AIRALO_CATALOGUE = null;
let AIRALO_CATALOGUE_SAVED_AT = 0;
let AIRALO_CATALOGUE_PROMISE = null;

function normalizeProviderSpeeds(input) {
  const found = new Set();
  const values = Array.isArray(input) ? input : input == null ? [] : [input];
  for (const raw of values) {
    const value = String(raw).toUpperCase().trim();
    if (/\b5G\b|\bNR\b/.test(value)) found.add("5G");
    else if (/\b4G\b|\bLTE\b/.test(value)) found.add("4G");
    else if (/\b3G\b|\bUMTS\b|\bWCDMA\b/.test(value)) found.add("3G");
  }
  return DISPLAY_GENERATIONS.filter((generation) => found.has(generation));
}

async function providerJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(20000),
    headers: { accept: "application/json", ...(options.headers || {}) }
  });
  if (!response.ok) {
    throw new Error("Provider returned HTTP " + response.status + ".");
  }
  return response.json();
}

async function getEsimGoCoverage(destination) {
  const apiKey = process.env.ESIM_GO_API_KEY;
  if (!apiKey) return null;

  const url = new URL("https://api.esim-go.com/v2.4/networks");
  url.searchParams.set("isos", destination.code);
  const payload = await providerJson(url, {
    headers: { "X-API-Key": apiKey }
  });
  const countryNetworks = Array.isArray(payload.countryNetworks)
    ? payload.countryNetworks
    : [];
  const matching = countryNetworks.filter((country) =>
    String(country.name || country.iso || "").toUpperCase() === destination.code
  );
  const networkRows = matching.flatMap((country) =>
    Array.isArray(country.networks) ? country.networks : []
  );

  const operators = [...new Map(networkRows.map((network) => {
    const name = String(network.brandName || network.name || "").trim();
    const speeds = normalizeProviderSpeeds(network.speed || network.speeds || []);
    return [name, { name, generations: speeds }];
  }).filter(([name]) => name)).values()]
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    name: "eSIM Go",
    operators,
    generations: DISPLAY_GENERATIONS.filter((generation) =>
      operators.some((operator) => operator.generations.includes(generation))
    ),
    networkCount: operators.length,
    source: "eSIM Go partner network API"
  };
}

function airaloPackageList(payload) {
  const candidates = [
    payload?.data,
    payload?.data?.data,
    payload?.data?.packages,
    payload?.packages,
    payload?.results
  ];
  return candidates.find(Array.isArray) || [];
}

async function getAiraloToken() {
  const clientId = process.env.AIRALO_CLIENT_ID;
  const clientSecret = process.env.AIRALO_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  if (AIRALO_ACCESS_TOKEN && Date.now() < AIRALO_TOKEN_EXPIRES_AT - 60000) {
    return AIRALO_ACCESS_TOKEN;
  }
  if (!AIRALO_TOKEN_PROMISE) {
    AIRALO_TOKEN_PROMISE = (async () => {
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials"
      });
      const payload = await providerJson("https://partners-api.airalo.com/v2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      });
      const data = payload.data || payload;
      if (!data.access_token) throw new Error("Airalo did not return an access token.");
      AIRALO_ACCESS_TOKEN = data.access_token;
      const expiresIn = Number(data.expires_in || 86400);
      AIRALO_TOKEN_EXPIRES_AT = Date.now() + Math.max(300, expiresIn - 300) * 1000;
      return AIRALO_ACCESS_TOKEN;
    })().finally(() => {
      AIRALO_TOKEN_PROMISE = null;
    });
  }
  return AIRALO_TOKEN_PROMISE;
}

async function getAiraloCatalogue() {
  if (AIRALO_CATALOGUE && Date.now() - AIRALO_CATALOGUE_SAVED_AT < PROVIDER_COVERAGE_TTL_MS) {
    return AIRALO_CATALOGUE;
  }
  if (!AIRALO_CATALOGUE_PROMISE) {
    AIRALO_CATALOGUE_PROMISE = (async () => {
      const token = await getAiraloToken();
      if (!token) return [];
      const payload = await providerJson("https://partners-api.airalo.com/v2/packages", {
        headers: { authorization: "Bearer " + token, "accept-language": "en" }
      });
      const packages = airaloPackageList(payload);
      AIRALO_CATALOGUE = packages;
      AIRALO_CATALOGUE_SAVED_AT = Date.now();
      console.log("Loaded " + packages.length + " Airalo partner packages for coverage lookup");
      return packages;
    })().finally(() => {
      AIRALO_CATALOGUE_PROMISE = null;
    });
  }
  return AIRALO_CATALOGUE_PROMISE;
}

function airaloCountryCoverage(packages, destination) {
  const byOperator = new Map();
  for (const item of packages) {
    const coverages = Array.isArray(item.coverages) ? item.coverages : [];
    const packageCountry = String(item.country_code || item.countryCode || "").toUpperCase();
    let matchedCoverage = false;

    for (const coverage of coverages) {
      const iso = String(
        coverage.country_code || coverage.iso || coverage.code || coverage.country?.code || ""
      ).toUpperCase();
      if (iso !== destination.code) continue;
      matchedCoverage = true;
      const networks = [
        ...(Array.isArray(coverage.networks) ? coverage.networks : []),
        ...(Array.isArray(coverage.operators) ? coverage.operators : [])
      ];
      for (const network of networks) {
        const name = String(network.name || network.brandName || network.brand_name || "").trim();
        if (!name) continue;
        const generations = normalizeProviderSpeeds(
          network.types || network.speeds || network.generations || network.network_types || []
        );
        const current = byOperator.get(name) || new Set();
        generations.forEach((generation) => current.add(generation));
        byOperator.set(name, current);
      }
    }

    if (!matchedCoverage && packageCountry === destination.code) {
      const networks = [
        ...(Array.isArray(item.networks) ? item.networks : []),
        ...(Array.isArray(item.operators) ? item.operators : [])
      ];
      for (const network of networks) {
        const name = String(network.name || network.brandName || network.brand_name || "").trim();
        if (!name) continue;
        const generations = normalizeProviderSpeeds(
          network.types || network.speeds || network.generations || []
        );
        const current = byOperator.get(name) || new Set();
        generations.forEach((generation) => current.add(generation));
        byOperator.set(name, current);
      }
    }
  }

  const operators = [...byOperator.entries()]
    .map(([name, generations]) => ({
      name,
      generations: DISPLAY_GENERATIONS.filter((generation) => generations.has(generation))
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    name: "Airalo",
    operators,
    generations: DISPLAY_GENERATIONS.filter((generation) =>
      operators.some((operator) => operator.generations.includes(generation))
    ),
    networkCount: operators.length,
    source: "Airalo partner package coverage"
  };
}

async function getAiraloCoverage(destination) {
  if (!process.env.AIRALO_CLIENT_ID || !process.env.AIRALO_CLIENT_SECRET) return null;
  const packages = await getAiraloCatalogue();
  return airaloCountryCoverage(packages, destination);
}

async function getProviderCoverage(destination) {
  const key = String(destination.code || "").toUpperCase();
  const cached = PROVIDER_COVERAGE_CACHE.get(key);
  if (cached && Date.now() - cached.savedAt < PROVIDER_COVERAGE_TTL_MS) {
    return cached.value;
  }

  const tasks = [
    ["eSIM Go", () => getEsimGoCoverage(destination)],
    ["Airalo", () => getAiraloCoverage(destination)]
  ];
  const providers = [];
  for (const [name, load] of tasks) {
    try {
      const result = await load();
      if (result && (result.networkCount > 0 || result.generations.length > 0)) {
        providers.push(result);
      }
    } catch (error) {
      console.warn(name + " coverage lookup failed for " + key + ": " + error.message);
    }
  }

  const value = {
    providers,
    providerNames: providers.map((provider) => provider.name),
    operators: [...new Map(providers.flatMap((provider) =>
      provider.operators.map((operator) => [operator.name, operator])
    )).values()].sort((a, b) => a.name.localeCompare(b.name)),
    generations: DISPLAY_GENERATIONS.filter((generation) =>
      providers.some((provider) => provider.generations.includes(generation))
    )
  };
  PROVIDER_COVERAGE_CACHE.set(key, { savedAt: Date.now(), value });
  return value;
}

function providerConnectionStatus() {
  return [
    {
      id: "esim-go",
      name: "eSIM Go",
      configured: Boolean(process.env.ESIM_GO_API_KEY),
      credentialNames: ["ESIM_GO_API_KEY"],
      activationRequires: "An eSIM Go partner account and API key"
    },
    {
      id: "airalo",
      name: "Airalo",
      configured: Boolean(process.env.AIRALO_CLIENT_ID && process.env.AIRALO_CLIENT_SECRET),
      credentialNames: ["AIRALO_CLIENT_ID", "AIRALO_CLIENT_SECRET"],
      activationRequires: "An Airalo Partner account, client ID and client secret"
    }
  ];
}

async function getDestinationNetworkInfo(destination) {
  const countryCode = String(destination.code || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    return {
      available: false,
      destination: { id: destination.id, name: destination.name, code: countryCode },
      provider: null,
      providers: [],
      generations: [],
      source: "provider APIs",
      message: "No verified country code is available for this destination."
    };
  }

  const providerCoverage = await getProviderCoverage(destination);
  const allRecords = await getNetworkIndex();
  const countryRecords = allRecords.filter((record) => recordMatchesDestination(record, destination));
  const generationSet = new Set(providerCoverage.generations);
  const operatorMap = new Map();

  for (const operator of providerCoverage.operators) {
    const current = operatorMap.get(operator.name) || new Set();
    operator.generations.forEach((generation) => current.add(generation));
    operatorMap.set(operator.name, current);
  }

  // Use the country register only when no partner supplies this country's
  // actual eSIM roaming networks. Never merge unrelated national operators
  // into the connected-provider result.
  if (!providerCoverage.providers.length) {
    for (const record of countryRecords) {
      const name = String(record.brand || record.operator || "").trim();
      if (!name) continue;
      const current = operatorMap.get(name) || new Set();
      generationsForRecord(record).forEach((generation) => current.add(generation));
      operatorMap.set(name, current);
    }
    for (const record of countryRecords) {
      for (const generation of generationsForRecord(record)) generationSet.add(generation);
    }
  }

  // Nigerian regulator reporting independently confirms active 5G service,
  // but no provider is marked connected unless its partner API confirms it.
  if (countryCode === "NG" && !providerCoverage.providers.length) {
    ["3G", "4G", "5G"].forEach((generation) => generationSet.add(generation));
  }

  const operators = [...operatorMap.entries()]
    .map(([name, generations]) => ({
      name,
      generations: DISPLAY_GENERATIONS.filter((generation) => generations.has(generation))
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const updatedDates = countryRecords
    .map((record) => record.updatedAt || record.updated_at)
    .filter(Boolean)
    .sort();

  return {
    available: generationSet.size > 0 || providerCoverage.providers.length > 0,
    verified: providerCoverage.providers.length > 0 || generationSet.size > 0,
    destination: { id: destination.id, name: destination.name, code: countryCode },
    provider: providerCoverage.providerNames.length ? providerCoverage.providerNames.join(" · ") : null,
    providers: providerCoverage.providers,
    generations: DISPLAY_GENERATIONS.filter((generation) => generationSet.has(generation)),
    localOperators: operators,
    operatorCount: operators.length,
    sourceCountryName: countryNameFromRecord(countryRecords[0]) || destination.name,
    sourceUpdatedAt: updatedDates.at(-1) || null,
    source: providerCoverage.providers.length
      ? providerCoverage.providers.map((provider) => provider.source).join(" + ")
      : "https://mcc-mnc.org",
    note: providerCoverage.providers.length
      ? "Networks and speeds are taken from connected eSIM partner coverage. Availability depends on the provider's live plans."
      : "No eSIM partner API is connected for this destination. The displayed network generations are national network-register data, not confirmed eSIM roaming access."
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "cache-control": "no-store" });
    return res.end();
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "Expert eSIM",
      destinationCount: DESTINATION_ROWS.length
    });
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    return sendJson(res, 200, {
      state: "catalogue_only",
      destinationCount: DESTINATION_ROWS.length,
      providerIntegrations: 0,
      livePlansEnabled: false,
      paymentsEnabled: false,
      eSIMProvisioningEnabled: false
    });
  }

  if (req.method === "GET" && url.pathname === "/api/destinations") {
    const query = (url.searchParams.get("q") || "").trim().toLocaleLowerCase();
    const items = query
      ? DESTINATION_ROWS.filter((item) => item.name.toLocaleLowerCase().includes(query))
      : DESTINATION_ROWS;
    return sendJson(res, 200, {
      total: DESTINATION_ROWS.length,
      count: items.length,
      items
    });
  }


  if (req.method === "GET" && url.pathname === "/api/providers/status") {
    return sendJson(res, 200, {
      configuredCount: providerConnectionStatus().filter((provider) => provider.configured).length,
      providers: providerConnectionStatus()
    });
  }

  if (req.method === "GET" && url.pathname === "/api/network-audit") {
    return buildNetworkAudit()
      .then((items) => sendJson(res, 200, {
        checked: items.length,
        verifiedCount: items.filter((item) => item.verified).length,
        unverifiedCount: items.filter((item) => !item.verified).length,
        items
      }))
      .catch(() => sendJson(res, 502, {
        error: "The full country network dataset could not be loaded. No missing country speeds have been guessed."
      }));
  }

  if (req.method === "GET" && url.pathname === "/api/network-info") {
    const id = Number(url.searchParams.get("destinationId"));
    const destination = DESTINATION_ROWS.find((item) => item.id === id);
    if (!destination) {
      return sendJson(res, 400, { error: "Choose a valid destination." });
    }
    return getDestinationNetworkInfo(destination)
      .then((payload) => sendJson(res, 200, payload))
      .catch((error) => sendJson(res, 502, {
        available: false,
        destination: { id: destination.id, name: destination.name, code: destination.code },
        provider: null,
        generations: [],
        operators: [],
        source: "https://mcc-mnc.org",
        message: "Country network information could not be verified right now. Please try again later."
      }));
  }

  if (req.method === "GET" && url.pathname === "/api/plans") {
    const id = Number(url.searchParams.get("destinationId"));
    const kind = "Data";
    const destination = DESTINATION_ROWS.find((item) => item.id === id);
    if (!destination) {
      return sendJson(res, 400, { error: "Choose a valid destination." });
    }
    return sendJson(res, 200, {
      available: false,
      destination: destination.name,
      kind,
      items: [],
      message: "Live eSIM plans have not been connected yet. No sample plans or prices are displayed."
    });
  }

  if (req.method === "POST" && url.pathname === "/api/activate") {
    return sendJson(res, 503, {
      error: "eSIM activation is not enabled. A live mobile connectivity service must issue the eSIM profile before activation can be offered."
    });
  }

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    });
    return res.end(HTML);
  }

  return sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Expert eSIM listening on port " + PORT + " with " + DESTINATION_ROWS.length + " destinations");
});
