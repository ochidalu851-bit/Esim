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


const NETWORK_CACHE = new Map();
const NETWORK_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DISPLAY_GENERATIONS = ["3G", "4G", "5G"];

async function getDestinationNetworkInfo(destination) {
  const countryCode = String(destination.code || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    return {
      available: false,
      destination: { id: destination.id, name: destination.name, code: countryCode },
      provider: null,
      generations: [],
      operators: [],
      message: "No verified country code is available for this destination.",
      source: "https://mcc-mnc.org"
    };
  }

  const cached = NETWORK_CACHE.get(countryCode);
  if (cached && Date.now() - cached.savedAt < NETWORK_CACHE_TTL_MS) {
    return { ...cached.value, destination: { id: destination.id, name: destination.name, code: countryCode } };
  }

  const records = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore && offset < 2000) {
    const endpoint = new URL("https://mcc-mnc.org/api/v1/networks");
    endpoint.searchParams.set("country", countryCode);
    endpoint.searchParams.set("limit", "200");
    endpoint.searchParams.set("offset", String(offset));
    const response = await fetch(endpoint, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      throw new Error("The mobile network register returned HTTP " + response.status + ".");
    }
    const payload = await response.json();
    const page = Array.isArray(payload.data) ? payload.data : [];
    records.push(...page);
    hasMore = payload.meta?.hasMore === true && page.length > 0;
    offset += page.length;
  }

  const operatorsByName = new Map();
  const allGenerations = new Set();
  let sourceCountryName = null;
  let sourceUpdatedAt = null;

  for (const record of records) {
    sourceCountryName = sourceCountryName || record.country?.name || null;
    if (record.updatedAt && (!sourceUpdatedAt || record.updatedAt > sourceUpdatedAt)) {
      sourceUpdatedAt = record.updatedAt;
    }

    const rawGenerations = [
      ...(Array.isArray(record.generations) ? record.generations : []),
      ...(Array.isArray(record.networkTypes) ? record.networkTypes.flatMap((type) => Array.isArray(type.generations) ? type.generations : []) : [])
    ];
    const generations = [...new Set(rawGenerations.map((value) => String(value).toUpperCase()))]
      .filter((value) => DISPLAY_GENERATIONS.includes(value))
      .sort((a, b) => DISPLAY_GENERATIONS.indexOf(a) - DISPLAY_GENERATIONS.indexOf(b));

    if (!generations.length) continue;

    const name = String(record.brand || record.operator || "").trim();
    if (!name) continue;

    const existing = operatorsByName.get(name) || {
      name,
      operator: String(record.operator || name),
      generations: new Set()
    };
    generations.forEach((generation) => {
      existing.generations.add(generation);
      allGenerations.add(generation);
    });
    operatorsByName.set(name, existing);
  }

  const operators = [...operatorsByName.values()]
    .map((item) => ({
      name: item.name,
      operator: item.operator,
      generations: DISPLAY_GENERATIONS.filter((generation) => item.generations.has(generation))
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const value = {
    available: true,
    destination: { id: destination.id, name: destination.name, code: countryCode },
    provider: null,
    generations: DISPLAY_GENERATIONS.filter((generation) => allGenerations.has(generation)),
    operators,
    sourceCountryName,
    sourceUpdatedAt,
    source: "https://mcc-mnc.org",
    note: "These are locally recorded operator network generations, not confirmation of roaming access or guaranteed coverage for an eSIM plan."
  };
  NETWORK_CACHE.set(countryCode, { savedAt: Date.now(), value });
  return value;
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
