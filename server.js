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


const COUNTRY_CARRIER_DATA_PATH = path.join(__dirname, "public", "data", "country-carrier-data.json");
let COUNTRY_CARRIER_DATA = null;
try {
  COUNTRY_CARRIER_DATA = JSON.parse(fs.readFileSync(COUNTRY_CARRIER_DATA_PATH, "utf8"));
  console.log(
    "Loaded source-backed eSIM carrier records for " +
    Object.keys(COUNTRY_CARRIER_DATA.countries || {}).length + " ISO destinations"
  );
} catch (error) {
  console.warn("Country eSIM carrier dataset is unavailable: " + error.message);
}



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

function getDestinationNetworkInfo(destination) {
  const countryCode = String(destination.code || "").toUpperCase();
  const record = COUNTRY_CARRIER_DATA?.countries?.[countryCode];

  if (!record) {
    return {
      available: false,
      verified: false,
      destination: { id: destination.id, name: destination.name, code: countryCode },
      provider: "Country provider record unavailable",
      esimCarriers: [],
      localEsimCarriers: [],
      travelEsimProviders: [],
      generations: [],
      localOperators: [],
      operatorCount: 0,
      source: COUNTRY_CARRIER_DATA?.sources || null,
      message: "No country-specific source record is available for this destination."
    };
  }

  const allCarriers = Array.isArray(record.esimCarriers) ? record.esimCarriers : [];
  const localCarriers = Array.isArray(record.localEsimCarriers)
    ? record.localEsimCarriers
    : allCarriers.filter((item) => item.providerType !== "global_travel_esim");
  const travelProviders = Array.isArray(record.travelEsimProviders)
    ? record.travelEsimProviders
    : allCarriers.filter((item) => item.providerType === "global_travel_esim");
  const localCarrierNames = localCarriers.map((item) => item.name).filter(Boolean);
  const travelProviderNames = travelProviders.map((item) => item.name).filter(Boolean);
  const generations = Array.isArray(record.generations) ? record.generations : [];
  const localOperators = Array.isArray(record.operators) ? record.operators : [];
  const providerParts = [];
  if (localCarrierNames.length) providerParts.push(localCarrierNames.join(" · "));
  if (travelProviderNames.length) providerParts.push("Travel eSIM: " + travelProviderNames.join(" · "));
  const providerLabel = providerParts.length
    ? providerParts.join(" | ")
    : "No source-listed eSIM provider";

  return {
    available: true,
    verified: Boolean(record.networkDataVerified || allCarriers.length),
    destination: { id: destination.id, name: destination.name, code: countryCode },
    provider: providerLabel,
    esimCarriers: allCarriers,
    localEsimCarriers: localCarriers,
    travelEsimProviders: travelProviders,
    generations,
    localOperators,
    operatorCount: Number(record.operatorCount || localOperators.length),
    networkRecordCount: Number(record.networkRecordCount || 0),
    networkSourceUpdatedAt: record.networkSourceUpdatedAt || null,
    source: COUNTRY_CARRIER_DATA.sources,
    sourceNotes: Array.isArray(record.sourceNotes) ? record.sourceNotes : [],
    note: "eSIM provider names are taken from Apple's country/region iPhone eSIM carrier directory. Speeds are the radio generations recorded for mobile networks in the destination; actual network access depends on the carrier, plan, device and local coverage."
  };
}


let AIRALO_PARTNER_ACCESS_TOKEN = null;
let AIRALO_PARTNER_TOKEN_EXPIRES_AT = 0;
let AIRALO_PACKAGE_CACHE = new Map();
let ESIM_GO_PACKAGE_CACHE = new Map();
const PROVIDER_CATALOGUE_CACHE_MS = 60 * 60 * 1000;

function extractProviderRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.data && typeof payload.data === "object") {
    for (const key of ["packages", "bundles", "items", "results"]) {
      if (Array.isArray(payload.data[key])) return payload.data[key];
    }
  }
  for (const key of ["packages", "bundles", "items", "results"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function countryIsInPackage(item, countryCode) {
  const code = String(countryCode || "").toUpperCase();
  const direct = [
    item.country_code, item.countryCode, item.iso, item.iso2,
    item.country_iso, item.countryIso
  ].filter(Boolean).map((value) => String(value).toUpperCase());
  if (direct.includes(code)) return true;
  const countries = Array.isArray(item.countries) ? item.countries : [];
  return countries.some((country) =>
    String(country.iso || country.iso2 || country.code || "").toUpperCase() === code
  );
}

function formatMb(value) {
  const mb = Number(value);
  if (!Number.isFinite(mb) || mb <= 0) return "";
  if (mb >= 1024) {
    const gb = mb / 1024;
    return (Number.isInteger(gb) ? gb.toFixed(0) : gb.toFixed(1)) + " GB";
  }
  return Math.round(mb) + " MB";
}

function normalizeAiraloPackage(item) {
  const pkg = item.package || item;
  const priceValue = Number(pkg.price ?? pkg.net_price ?? pkg.retail_price);
  const currency = String(pkg.currency || pkg.currency_code || item.currency || "USD");
  const priceDisplay = Number.isFinite(priceValue)
    ? new Intl.NumberFormat("en", { style: "currency", currency }).format(priceValue)
    : "";
  const operators = Array.isArray(pkg.operators)
    ? pkg.operators.map((operator) => operator.title || operator.name || operator.operator_name).filter(Boolean)
    : [];
  const data = pkg.data || pkg.data_amount || pkg.amount || "";
  const validityDays = Number(pkg.validity || pkg.validity_days || pkg.day || 0);
  return {
    provider: "Airalo",
    packageId: String(pkg.package_id || pkg.id || ""),
    name: String(pkg.title || pkg.name || pkg.package_name || "Airalo eSIM"),
    dataAllowance: typeof data === "string" ? data : formatMb(data),
    validity: validityDays > 0 ? validityDays + " days" : String(pkg.validity_text || ""),
    price: Number.isFinite(priceValue) ? priceValue : null,
    currency,
    priceDisplay,
    operator: operators.join(", "),
    countryCode: String(pkg.country_code || pkg.countryCode || (pkg.countries?.[0]?.iso || "")).toUpperCase(),
    source: "Airalo Partner API"
  };
}

async function getAiraloAccessToken() {
  if (!process.env.AIRALO_CLIENT_ID || !process.env.AIRALO_CLIENT_SECRET) {
    throw new Error("Airalo Partner API credentials are not configured.");
  }
  if (AIRALO_PARTNER_ACCESS_TOKEN && Date.now() < AIRALO_PARTNER_TOKEN_EXPIRES_AT) {
    return AIRALO_PARTNER_ACCESS_TOKEN;
  }
  const form = new URLSearchParams({
    client_id: process.env.AIRALO_CLIENT_ID,
    client_secret: process.env.AIRALO_CLIENT_SECRET,
    grant_type: "client_credentials"
  });
  const response = await fetch("https://partners-api.airalo.com/v2/token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(20000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.data?.access_token) {
    throw new Error("Airalo authentication failed with HTTP " + response.status + ".");
  }
  AIRALO_PARTNER_ACCESS_TOKEN = payload.data.access_token;
  const expiresIn = Number(payload.data.expires_in || 86400);
  AIRALO_PARTNER_TOKEN_EXPIRES_AT = Date.now() + Math.max(60, expiresIn - 300) * 1000;
  return AIRALO_PARTNER_ACCESS_TOKEN;
}

async function getAiraloPackages(countryCode) {
  const key = String(countryCode).toUpperCase();
  const cached = AIRALO_PACKAGE_CACHE.get(key);
  if (cached && Date.now() - cached.savedAt < PROVIDER_CATALOGUE_CACHE_MS) return cached.items;
  const token = await getAiraloAccessToken();
  const endpoint = new URL("https://partners-api.airalo.com/v2/packages");
  endpoint.searchParams.set("limit", "1000");
  endpoint.searchParams.set("page", "1");
  endpoint.searchParams.set("filter[country]", key);
  const response = await fetch(endpoint, {
    headers: {
      accept: "application/json",
      authorization: "Bearer " + token,
      "accept-language": "en",
      url: "https://partners-api.airalo.com"
    },
    signal: AbortSignal.timeout(25000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Airalo package catalogue failed with HTTP " + response.status + ".");
  const rows = extractProviderRows(payload).filter((item) => countryIsInPackage(item, key));
  const items = rows.map(normalizeAiraloPackage).filter((item) => item.packageId);
  AIRALO_PACKAGE_CACHE.set(key, { savedAt: Date.now(), items });
  return items;
}

function normalizeEsimGoPackage(item) {
  const countries = Array.isArray(item.countries) ? item.countries : [];
  const priceValue = Number(item.price);
  const allowance = (item.allowances || []).find((entry) => String(entry.type || "").toUpperCase() === "DATA");
  const dataAllowance = item.unlimited || allowance?.unlimited
    ? "Unlimited data"
    : formatMb(item.dataAmount || allowance?.amount);
  const validityDays = Number(item.duration || item.validity || 0);
  const profile = String(item.profileName || item.operator || "");
  return {
    provider: "eSIM Go",
    packageId: String(item.name || item.bundleName || ""),
    name: String(item.description || item.name || "eSIM Go plan"),
    dataAllowance,
    validity: validityDays > 0 ? validityDays + " days" : "",
    price: Number.isFinite(priceValue) ? priceValue : null,
    currency: String(item.currency || ""),
    priceDisplay: Number.isFinite(priceValue)
      ? new Intl.NumberFormat("en", {
          style: "currency",
          currency: String(item.currency || "USD")
        }).format(priceValue)
      : "",
    operator: profile,
    countryCode: countries.map((country) => String(country.iso || "").toUpperCase()).join(","),
    source: "eSIM Go API"
  };
}

async function getEsimGoPackages(countryCode) {
  if (!process.env.ESIM_GO_API_KEY) {
    throw new Error("eSIM Go API key is not configured.");
  }
  const key = String(countryCode).toUpperCase();
  const cached = ESIM_GO_PACKAGE_CACHE.get(key);
  if (cached && Date.now() - cached.savedAt < PROVIDER_CATALOGUE_CACHE_MS) return cached.items;
  const endpoint = new URL("https://api.esim-go.com/v2.5/catalogue");
  endpoint.searchParams.set("countries", key);
  endpoint.searchParams.set("page", "1");
  endpoint.searchParams.set("perPage", "100");
  const response = await fetch(endpoint, {
    headers: { accept: "application/json", "X-API-Key": process.env.ESIM_GO_API_KEY },
    signal: AbortSignal.timeout(25000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("eSIM Go catalogue failed with HTTP " + response.status + ".");
  const rows = extractProviderRows(payload).filter((item) => countryIsInPackage(item, key));
  const items = rows.map(normalizeEsimGoPackage).filter((item) => item.packageId);
  ESIM_GO_PACKAGE_CACHE.set(key, { savedAt: Date.now(), items });
  return items;
}

function getProvisioningStatus() {
  const airaloConfigured = Boolean(process.env.AIRALO_CLIENT_ID && process.env.AIRALO_CLIENT_SECRET);
  const esimGoConfigured = Boolean(process.env.ESIM_GO_API_KEY);
  const paymentConfigured = Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
  return {
    providers: [
      {
        id: "airalo",
        name: "Airalo",
        configured: airaloConfigured,
        capabilities: ["live_packages", "eSIM_ordering", "installation_instructions"]
      },
      {
        id: "esim-go",
        name: "eSIM Go",
        configured: esimGoConfigured,
        capabilities: ["live_catalogue", "eSIM_ordering", "QR_installation", "suspend_unsuspend"]
      }
    ],
    paymentConfigured,
    customerAccountsConfigured: Boolean(process.env.AUTH_SECRET && process.env.DATABASE_URL),
    directPhoneProfileControl: false,
    catalogueConnected: airaloConfigured || esimGoConfigured,
    liveOrdersReady: false
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

async function runExternalSourceDiagnostics() {
  const targets = [
    ["apple", "https://support.apple.com/en-us/101569"],
    ["mccDownload", "https://mcc-mnc.org/downloads/networks.json?generation=3G%2C4G%2C5G"],
    ["mccApi", "https://mcc-mnc.org/api/v1/networks?country=NG&limit=200&offset=0"]
  ];
  const results = [];
  for (const [id, target] of targets) {
    try {
      const response = await fetch(target, {
        headers: { accept: id === "apple" ? "text/html" : "application/json", "user-agent": "ExpertESIM/1.0 (country carrier index)" },
        signal: AbortSignal.timeout(18000)
      });
      const body = await response.text();
      let json = null;
      try { json = JSON.parse(body); } catch {}
      const keys = json && typeof json === "object" ? Object.keys(json) : [];
      const candidates = json && typeof json === "object"
        ? [json.data, json.networks, json.results, json.items, json]
        : [];
      const arrays = candidates.filter(Array.isArray);
      const records = arrays[0] || [];
      results.push({
        id, status: response.status, contentType: response.headers.get("content-type"),
        bytes: Buffer.byteLength(body), keys, recordCount: records.length,
        firstRecord: records[0] || null,
        appleHasNigeria: id === "apple" ? body.toLowerCase().includes("nigeria") : undefined,
        appleHasHeadings: id === "apple" ? (body.match(/<h[1-3]\b/gi) || []).length : undefined,
        appleTitle: id === "apple" ? (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] : undefined,
        appleNigeriaSnippet: id === "apple"
          ? body.slice(Math.max(0, body.toLowerCase().indexOf("nigeria") - 400), body.toLowerCase().indexOf("nigeria") + 800)
          : undefined
      });
    } catch (error) {
      results.push({ id, error: error.message });
    }
  }
  return results;
}

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "Expert eSIM",
      destinationCount: DESTINATION_ROWS.length
    });
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    const provisioning = getProvisioningStatus();
    return sendJson(res, 200, {
      state: "country_catalogue_with_source_data",
      destinationCount: DESTINATION_ROWS.length,
      countryCarrierDataLoaded: Boolean(COUNTRY_CARRIER_DATA),
      countriesWithEsimProviders: DESTINATION_ROWS.filter((destination) => {
        const item = COUNTRY_CARRIER_DATA?.countries?.[destination.code];
        return Boolean(item?.esimCarrierCount);
      }).length,
      countriesWithLocalEsimCarriers: DESTINATION_ROWS.filter((destination) => {
        const item = COUNTRY_CARRIER_DATA?.countries?.[destination.code];
        return Boolean(item?.localEsimCarrierCount);
      }).length,
      countriesWithTravelEsimProviders: DESTINATION_ROWS.filter((destination) => {
        const item = COUNTRY_CARRIER_DATA?.countries?.[destination.code];
        return Boolean(item?.travelEsimProviderCount);
      }).length,
      countriesWithNetworkGenerations: DESTINATION_ROWS.filter((destination) => {
        const item = COUNTRY_CARRIER_DATA?.countries?.[destination.code];
        return Boolean(item?.networkDataVerified);
      }).length,
      providerIntegrations: provisioning.providers.filter((provider) => provider.configured).length,
      livePlansEnabled: provisioning.providers.some((provider) => provider.configured),
      paymentsEnabled: provisioning.paymentConfigured,
      eSIMProvisioningEnabled: provisioning.liveOrdersReady,
      provisioning
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
    const items = DESTINATION_ROWS.map((destination) => {
      const record = COUNTRY_CARRIER_DATA?.countries?.[destination.code] || null;
      return {
        id: destination.id,
        name: destination.name,
        code: destination.code,
        verified: Boolean(record?.networkDataVerified),
        generations: record?.generations || [],
        providerVerified: Boolean(record?.esimCarrierCount),
        esimCarrierCount: Number(record?.esimCarrierCount || 0),
        localEsimCarrierCount: Number(record?.localEsimCarrierCount || 0),
        travelEsimProviderCount: Number(record?.travelEsimProviderCount || 0),
        networkRecordCount: Number(record?.networkRecordCount || 0),
        sourceNotes: record?.sourceNotes || []
      };
    });
    return sendJson(res, 200, {
      checked: items.length,
      verifiedCount: items.filter((item) => item.verified).length,
      unverifiedCount: items.filter((item) => !item.verified).length,
      providerVerifiedCount: items.filter((item) => item.providerVerified).length,
      providerUnlistedCount: items.filter((item) => !item.providerVerified).length,
      sourceGeneratedAt: COUNTRY_CARRIER_DATA?.generatedAt || null,
      sources: COUNTRY_CARRIER_DATA?.sources || null,
      items
    });
  }

  if (req.method === "GET" && url.pathname === "/api/network-info") {
    const id = Number(url.searchParams.get("destinationId"));
    const destination = DESTINATION_ROWS.find((item) => item.id === id);
    if (!destination) {
      return sendJson(res, 400, { error: "Choose a valid destination." });
    }
    return sendJson(res, 200, getDestinationNetworkInfo(destination));
  }

  if (req.method === "GET" && url.pathname === "/api/provisioning/status") {
    return sendJson(res, 200, getProvisioningStatus());
  }

  if (req.method === "GET" && url.pathname === "/api/plans") {
    const id = Number(url.searchParams.get("destinationId"));
    const destination = DESTINATION_ROWS.find((item) => item.id === id);
    if (!destination) {
      return sendJson(res, 400, { error: "Choose a valid destination." });
    }
    const status = getProvisioningStatus();
    const jobs = [];
    if (status.providers.find((provider) => provider.id === "airalo").configured) {
      jobs.push(getAiraloPackages(destination.code).catch((error) => {
        console.warn("Airalo packages unavailable for " + destination.code + ": " + error.message);
        return [];
      }));
    }
    if (status.providers.find((provider) => provider.id === "esim-go").configured) {
      jobs.push(getEsimGoPackages(destination.code).catch((error) => {
        console.warn("eSIM Go packages unavailable for " + destination.code + ": " + error.message);
        return [];
      }));
    }
    return Promise.all(jobs).then((catalogues) => {
      const items = catalogues.flat().sort((a, b) => {
        const providerOrder = a.provider.localeCompare(b.provider);
        return providerOrder || (Number(a.price || 0) - Number(b.price || 0));
      });
      return sendJson(res, 200, {
        available: items.length > 0,
        destination: destination.name,
        items,
        provisioning: status
      });
    });
  }

  if (req.method === "POST" && url.pathname === "/api/activate") {
    const provisioning = getProvisioningStatus();
    if (!provisioning.paymentConfigured) {
      return sendJson(res, 503, {
        error: "Payment processing and verified customer checkout must be connected before live eSIM orders can be placed.",
        provisioning
      });
    }
    return sendJson(res, 501, {
      error: "Checkout verification is not implemented for this project yet.",
      provisioning
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
