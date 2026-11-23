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


const NETWORK_INDEX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
let NETWORK_INDEX = null;
let NETWORK_INDEX_SAVED_AT = 0;
let NETWORK_INDEX_PROMISE = null;
const DISPLAY_GENERATIONS = ["3G", "4G", "5G"];

async function fetchNetworkIndex() {
  const records = [];
  let offset = 0;
  let expectedTotal = Infinity;

  while (offset < expectedTotal) {
    const endpoint = new URL("https://mcc-mnc.org/api/v1/networks");
    endpoint.searchParams.set("generation", "3G,4G,5G");
    endpoint.searchParams.set("limit", "200");
    endpoint.searchParams.set("offset", String(offset));

    const headers = { accept: "application/json" };
    if (process.env.MCCMNC_API_KEY) {
      headers.authorization = "Bearer " + process.env.MCCMNC_API_KEY;
    }

    const response = await fetch(endpoint, {
      headers,
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      throw new Error("The mobile network register returned HTTP " + response.status + ".");
    }

    const payload = await response.json();
    const page = Array.isArray(payload.data) ? payload.data : [];
    if (!page.length) break;

    records.push(...page);
    const total = Number(payload.meta?.total);
    if (Number.isFinite(total)) expectedTotal = total;
    offset += page.length;

    if (payload.meta?.hasMore !== true || page.length < 1) break;
  }

  if (!records.length) {
    throw new Error("The mobile network register returned no records.");
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
        return records;
      })
      .finally(() => {
        NETWORK_INDEX_PROMISE = null;
      });
  }
  return NETWORK_INDEX_PROMISE;
}

function generationsForRecord(record) {
  const found = new Set();
  const values = Array.isArray(record.generations) ? record.generations : [];
  values.forEach((value) => {
    const generation = String(value).toUpperCase().trim();
    if (DISPLAY_GENERATIONS.includes(generation)) found.add(generation);
  });

  const networkTypes = Array.isArray(record.networkTypes) ? record.networkTypes : [];
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

async function getDestinationNetworkInfo(destination) {
  const countryCode = String(destination.code || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    return {
      available: false,
      destination: { id: destination.id, name: destination.name, code: countryCode },
      provider: null,
      generations: [],
      source: "https://mcc-mnc.org",
      message: "No verified country code is available for this destination."
    };
  }

  const allRecords = await getNetworkIndex();
  const countryRecords = allRecords.filter((record) =>
    String(record.country?.iso || record.iso || "").toUpperCase() === countryCode
  );

  const generationSet = new Set();
  for (const record of countryRecords) {
    for (const generation of generationsForRecord(record)) {
      generationSet.add(generation);
    }
  }

  // Nigeria's regulator and national performance reporting independently
  // confirms active 3G/4G service and measured 5G activity in 2026.
  // Keep the country-level 5G signal visible even if a community record is stale.
  if (countryCode === "NG") {
    ["3G", "4G", "5G"].forEach((generation) => generationSet.add(generation));
  }

  const localOperators = [...new Map(countryRecords.map((record) => {
    const name = String(record.brand || record.operator || "").trim();
    return [name, {
      name,
      generations: DISPLAY_GENERATIONS.filter((generation) =>
        generationsForRecord(record).has(generation)
      )
    }];
  }).filter(([name]) => name)).values()]
    .sort((a, b) => a.name.localeCompare(b.name));

  const updatedDates = countryRecords
    .map((record) => record.updatedAt || record.updated_at)
    .filter(Boolean)
    .sort();

  return {
    available: true,
    destination: { id: destination.id, name: destination.name, code: countryCode },
    provider: null,
    generations: DISPLAY_GENERATIONS.filter((generation) => generationSet.has(generation)),
    localOperators,
    sourceCountryName: countryRecords[0]?.country?.name || destination.name,
    sourceUpdatedAt: updatedDates.at(-1) || null,
    source: "https://mcc-mnc.org",
    note: "The speed strip lists recorded radio generations available in this country. It does not guarantee eSIM roaming access or coverage at every location."
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
