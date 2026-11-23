#!/usr/bin/env python3
from __future__ import annotations
import datetime as dt, json, re, sys, time, unicodedata
from collections import defaultdict
from pathlib import Path
from urllib.parse import urljoin
import pycountry, requests
from bs4 import BeautifulSoup, Tag

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/"public"/"data"
OUT.mkdir(parents=True,exist_ok=True)
APPLE="https://support.apple.com/en-us/101569"
MCC="https://mcc-mnc.org/api/v1/networks"
GENS=["3G","4G","5G"]
HEADERS={"User-Agent":"ExpertESIM-CountryDirectory/1.0","Accept":"text/html,application/json;q=0.9,*/*;q=0.8"}

def norm(value):
    value=unicodedata.normalize("NFKD",str(value or ""))
    value="".join(c for c in value if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+","",value.casefold().replace("&","and"))

def destinations():
    source=(ROOT/"server.js").read_text(encoding="utf-8")
    tick=chr(96)
    pattern=r"const DESTINATION_ROWS\s*=\s*"+re.escape(tick)+r"([\s\S]*?)"+re.escape(tick)+r"\.trim\(\)"
    match=re.search(pattern,source)
    if not match: raise RuntimeError("Could not read DESTINATION_ROWS from server.js")
    rows=[]
    for line in match.group(1).splitlines():
        if "|" in line:
            code,name=line.split("|",1)
            rows.append({"code":code.strip().upper(),"name":name.strip()})
    if len(rows)!=206: raise RuntimeError(f"Expected 206 destinations, found {len(rows)}")
    return rows

SPECIAL={
 "chinamainland":"CN","czechia":"CZ","democraticrepublicofcongo":"CD",
 "democraticrepublicofthecongo":"CD","republicofthecongo":"CG","congo":"CG",
 "ivorycoast":"CI","macao":"MO","macau":"MO","reunionisland":"RE","reunion":"RE",
 "niueisland":"NU","stbarts":"BL","saintbarthelemy":"BL","steustatius":"BQ",
 "sinteustatius":"BQ","stkittsandnevis":"KN","stlucia":"LC","stmartin":"MF",
 "saintmartin":"MF","usvirginislands":"VI","unitedstatesvirginislands":"VI",
 "turkiye":"TR","guinearepublic":"GN","timorleste":"TL","easttimor":"TL",
 "northmacedonia":"MK","palestine":"PS","kosovo":"XK","canaryislands":"ES",
 "azores":"PT","frenchguiana":"GF","frenchwestindies":"MQ","southkorea":"KR",
 "republicofkorea":"KR","unitedstates":"US","unitedstatesofamerica":"US",
 "vaticancity":"VA","turksandcaicos":"TC","turkscaicos":"TC"
}

def iso_for(name, rows):
    key=norm(name)
    row_map={norm(r["name"]):r["code"] for r in rows}
    if key in row_map: return row_map[key]
    if key in SPECIAL: return SPECIAL[key]
    try: return pycountry.countries.lookup(name).alpha_2
    except LookupError: return None

def list_entries_after(heading, stop_heading, base_url):
    entries=[]
    node=heading.find_next()
    while node is not None and node is not stop_heading:
        if isinstance(node,Tag) and node.name=="li" and not node.find_parent("li"):
            name=re.sub(r"\s+"," ",node.get_text(" ",strip=True)).strip()
            if name:
                a=node.find("a",href=True)
                entries.append({"name":name,"website":urljoin(base_url,a["href"]) if a else None})
        node=node.find_next()
    return entries

def apple_directory(html, rows):
    soup=BeautifulSoup(html,"html.parser")
    codes={r["code"] for r in rows}
    local=defaultdict(dict)
    globals_={}
    headings=soup.find_all(["h2","h3"])
    published=re.search(r"Published Date:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})",soup.get_text(" ",strip=True))
    for h in headings:
        title=h.get_text(" ",strip=True)
        key=norm(title)
        later=h.find_all_next(["h2","h3"])
        stop=later[0] if later else None
        if h.name=="h3" and key=="worldwideserviceproviders":
            for item in list_entries_after(h,stop,APPLE):
                globals_.setdefault(norm(item["name"]),item)
            continue
        if h.name!="h3": continue
        parent=h.find_previous("h2")
        if not parent: continue
        country_title=parent.get_text(" ",strip=True)
        if norm(country_title)=="worldwideserviceproviders": continue
        code=iso_for(country_title,rows)
        if code not in codes: continue
        group=title.casefold()
        if not ("wireless carrier" in group or "wireless network provider" in group or "service provider that support" in group):
            continue
        for item in list_entries_after(h,stop,APPLE):
            k=norm(item["name"])
            record=local[code].setdefault(k,{**item,"activationMethods":[]})
            if item.get("website") and not record.get("website"): record["website"]=item["website"]
            if title not in record["activationMethods"]: record["activationMethods"].append(title)
    # Apple publishes a worldwide provider list separately from country-specific carriers.
    # Mark brands appearing in that list as travel eSIM providers when they are also
    # named in a country's list; this keeps them distinct from local mobile operators.
    global_keys=set(globals_)
    for records in local.values():
        for record in records.values():
            record["providerType"]="global_travel_esim" if norm(record["name"]) in global_keys else "local_mobile_carrier"
    return ({c:sorted(v.values(),key=lambda x:x["name"].casefold()) for c,v in local.items()},
            sorted(globals_.values(),key=lambda x:x["name"].casefold()),
            published.group(1) if published else None)

def fetch_networks():
    session=requests.Session(); session.headers.update(HEADERS)
    all_rows=[]; offset=0; limit=200; total=None
    while True:
        response=session.get(MCC,params={"limit":limit,"offset":offset},timeout=30)
        response.raise_for_status()
        payload=response.json()
        page=payload.get("data"); meta=payload.get("meta") or {}
        if not isinstance(page,list): raise RuntimeError("MCC-MNC response data was not a list")
        all_rows.extend(page); total=meta.get("total",total)
        if not meta.get("hasMore",len(page)==limit): break
        if not page: raise RuntimeError("MCC-MNC pagination returned an empty page while hasMore=true")
        offset+=len(page); time.sleep(.12)
        if offset>10000: raise RuntimeError("MCC-MNC pagination exceeded safety limit")
    if not all_rows: raise RuntimeError("MCC-MNC API returned no networks")
    return all_rows,{"records":len(all_rows),"reportedTotal":total}

def generations(record):
    found=set()
    for value in record.get("generations") or []:
        value=str(value).upper().strip()
        if value in GENS: found.add(value)
    for item in record.get("networkTypes") or []:
        vals=item.get("generations") or []
        for value in vals:
            value=str(value).upper().strip()
            if value in GENS: found.add(value)
        name=(str(item.get("name") or "")+" "+str(item.get("slug") or "")).upper()
        if "5G" in name or "NR" in name: found.add("5G")
        elif "LTE" in name or "4G" in name: found.add("4G")
        elif "UMTS" in name or "WCDMA" in name or "3G" in name: found.add("3G")
    return [g for g in GENS if g in found]

def match_carrier(name, records):
    target=norm(name); matched=[]
    for row in records:
        brand=norm(row.get("brand") or "")
        operator=norm(row.get("operator") or "")
        if target and (target==brand or target==operator or (len(target)>=4 and (target in brand or brand in target))):
            matched.append(row)
    return {
      "name":name,
      "generations":[g for g in GENS if any(g in generations(row) for row in matched)],
      "matchedNetworkCount":len(matched)
    }

AIRALO_LOCAL_DESTINATION_CODES={
    # Airalo's public Local eSIM directory explicitly lists local packages for
    # these destinations, which Apple does not list in its iPhone carrier table.
    "DZ","CV","TD","SZ","ET","GF","GA","GM","LS","NE","BL","SX","SD","TG","VA","VE"
}

TERRITORY_NETWORK_OVERRIDES={
    "CW":{
        "generations":["4G"],
        "operators":[{"name":"Flow","generations":["4G"]},{"name":"Digicel","generations":["4G"]}],
        "source":"https://rac.cw/wp-content/uploads/2025/02/Annual-report-telecommunications_Policy-and-Market-Regulation_20feb2025.pdf",
        "note":"Curaçao regulator annual telecommunications report identifies Flow and Digicel mobile LTE (4G) networks. No 5G generation is added."
    },
    "GF":{
        "generations":["3G","4G","5G"],
        "operators":[
            {"name":"Orange Caraïbe","generations":["3G","4G","5G"]},
            {"name":"Outremer Télécom","generations":["3G","4G","5G"]},
            {"name":"Digicel","generations":["3G","4G"]},
            {"name":"Free Caraïbe","generations":["3G","4G"]}
        ],
        "source":"https://en.arcep.fr/news/press-releases/view/n/mobile-quality-of-service-qos-2026-antilles-guiana-221026.html",
        "note":"ARCEP's 2026 Antilles/Guiana audit names the operators and confirms 5G deployments by Orange and Outremer Télécom in French Guiana; the other listed operators are shown at 3G/4G."
    },
    "GP":{
        "generations":["3G","4G"],
        "operators":[{"name":"Orange Caraïbe","generations":["3G","4G"]},{"name":"SFR / Outremer Télécom","generations":["3G","4G"]}],
        "source":"https://antennes-relais-france.fr/antennes-en-projet?dep=971&operateur=free&techno=4g",
        "note":"Marie-Galante-specific antenna records show Orange and SFR 3G/4G sites on the island. 5G is not added because the cited Marie-Galante site records do not establish local 5G service."
    },
    "MQ":{
        "generations":["3G","4G","5G"],
        "operators":[
            {"name":"Orange Caraïbe","generations":["3G","4G","5G"]},
            {"name":"Outremer Télécom","generations":["3G","4G","5G"]},
            {"name":"Digicel","generations":["3G","4G"]},
            {"name":"Free Caraïbe","generations":["3G","4G"]}
        ],
        "source":"https://en.arcep.fr/news/press-releases/view/n/mobile-quality-of-service-qos-2026-antilles-guiana-221026.html",
        "note":"ARCEP's 2026 mobile audit confirms 5G deployment by Orange and Outremer Télécom in Martinique and measures the island's mobile networks."
    },
    "MS":{
        "generations":["3G","4G"],
        "operators":[{"name":"Flow","generations":["3G","4G"]},{"name":"Digicel","generations":["3G","4G"]}],
        "source":"https://blog.sparkroam.com/montserrat-mobile-network-coverage/",
        "note":"2026 Montserrat network guide describes Digicel and Flow 3G/4G-class service. No 5G is claimed; the regulator confirms licensed Flow and Digicel networks."
    },
    "PS":{
        "generations":["3G"],
        "operators":[{"name":"Jawwal","generations":["3G"]},{"name":"Ooredoo Palestine","generations":["3G"]}],
        "source":"https://www.jawwal.ps/ar/individuals/about-us/public-relations/11582",
        "note":"Jawwal's August 2026 results still described 4G as being prepared for launch. West Bank services are recorded as 3G; Gaza service conditions differ and should not be inferred from this country-level indicator."
    },
    "RE":{
        "generations":["3G","4G","5G"],
        "operators":[
            {"name":"Orange Réunion","generations":["3G","4G","5G"]},
            {"name":"SFR Réunion","generations":["3G","4G","5G"]},
            {"name":"Free Réunion","generations":["3G","4G","5G"]},
            {"name":"Zeop","generations":["3G","4G","5G"]}
        ],
        "source":"https://www.reunionenclair.re/reseau-mobile",
        "note":"Réunion's 2026 ANFR-based network report records active 3G/4G sites and 5G sites across the island for Orange, SFR, Free and Zeop."
    },
    "MF":{
        "generations":["3G","4G","5G"],
        "operators":[
            {"name":"Dauphin Telecom","generations":["3G","4G"]},
            {"name":"Orange","generations":["3G","4G","5G"]},
            {"name":"Digicel","generations":["3G","4G","5G"]},
            {"name":"Free Caraïbe","generations":["3G","4G","5G"]},
            {"name":"Flow","generations":["3G"]}
        ],
        "source":"https://www.sogudo.com/fr/saint-martin-partie-francaise",
        "note":"October 2026 ANFR-derived operator records for French Saint-Martin show 3G/4G on the listed networks and active 5G sites for Orange, Digicel and Free."
    },
    "SX":{
        "generations":["3G","4G","5G"],
        "operators":[
            {"name":"UTS","generations":["4G"]},
            {"name":"Cable & Wireless (Flow)","generations":["3G","4G"]},
            {"name":"Chippie","generations":["3G","4G"]},
            {"name":"Digicel","generations":["4G"]},
            {"name":"Liberty","generations":["4G"]},
            {"name":"TelCell","generations":["4G"]},
            {"name":"TelEm","generations":["3G","4G"]}
        ],
        "source":"https://esimdata.app/sint-maarten/",
        "note":"November 2026 eSIM network directory records local 3G/4G/LTE networks and reports at least one provider listing 5G for Sint Maarten; 5G availability is plan and network dependent."
    },
    "VA":{
        "generations":["4G","5G"],
        "operators":[
            {"name":"TIM (Italy)","generations":["4G","5G"]},
            {"name":"Vodafone Italia","generations":["4G","5G"]},
            {"name":"WindTre","generations":["4G","5G"]},
            {"name":"Iliad Italia","generations":["4G","5G"]}
        ],
        "source":"https://esimwatchdog.com/cheapest-esim-vatican-city/",
        "note":"Vatican City has no indigenous public mobile network; its mobile service is provided by Italian networks extending coverage from Rome. This records the surrounding 4G/5G networks, not a Vatican-owned carrier."
    },
    "VI":{
        "generations":["4G","5G"],
        "operators":[{"name":"T-Mobile","generations":["4G","5G"]}],
        "source":"https://carrierlytics.com/state/u-s-virgin-islands/",
        "note":"FCC Broadband Data Collection coverage processed in June 2026 shows T-Mobile 4G LTE and 5G coverage in the U.S. Virgin Islands; this is coverage evidence, not a claim that every carrier covers every island."
    }
}

def main():
    rows=destinations()
    session=requests.Session(); session.headers.update(HEADERS)
    apple_response=session.get(APPLE,timeout=45); apple_response.raise_for_status()
    html=apple_response.text
    if "Nigeria" not in html or "Find wireless carriers" not in html:
        raise RuntimeError("Apple carrier directory response did not contain its expected article")
    carriers,global_providers,apple_date=apple_directory(html,rows)
    airalo_source="https://www.airalo.com/local-esim"
    airalo_record=next((item for item in global_providers if norm(item["name"])=="airalo"),{"name":"Airalo","website":"https://www.airalo.com"})
    for code in AIRALO_LOCAL_DESTINATION_CODES:
        entry={**airalo_record,"providerType":"global_travel_esim",
               "activationMethods":["Local eSIM package listed in Airalo's Local eSIM directory"],
               "coverageSource":airalo_source}
        existing=carriers[code]
        if not any(norm(item["name"])=="airalo" for item in existing):
            existing.append(entry)
    networks,network_meta=fetch_networks()
    by_country=defaultdict(list)
    for network in networks:
        iso=str((network.get("country") or {}).get("iso") or "").upper()
        if iso: by_country[iso].append(network)
    countries={}
    for destination in rows:
        code=destination["code"]; local=by_country.get(code,[])
        all_gens=sorted({g for r in local for g in generations(r)},key=GENS.index)
        operator_map={}
        for record in local:
            name=str(record.get("brand") or record.get("operator") or "").strip()
            if not name: continue
            item=operator_map.setdefault(name,{"name":name,"gens":set(),"count":0})
            item["gens"].update(generations(record)); item["count"]+=1
        operators=[{"name":x["name"],"generations":[g for g in GENS if g in x["gens"]],"networkCount":x["count"]}
                   for x in sorted(operator_map.values(),key=lambda z:z["name"].casefold())]
        esim=[]
        for carrier in carriers.get(code,[]):
            detail=match_carrier(carrier["name"],local)
            esim.append({**carrier,"networkGenerations":detail["generations"],"matchedNetworkCount":detail["matchedNetworkCount"]})

        source_notes=[]
        if code=="NG":
            # NCC/Ookla August 2026 measurements observed 5G-capable device activity
            # on 5G for MTN, Airtel, T2 and Glo in Lagos and Abuja. T2 is the new
            # brand for 9mobile. This is evidence of active 5G usage, not nationwide coverage.
            ng_5g_names={"mtn","airtel","glo","9mobile","t2"}
            for carrier in esim:
                if norm(carrier["name"]) in ng_5g_names and "5G" not in carrier["networkGenerations"]:
                    carrier["networkGenerations"]=[g for g in GENS if g in set(carrier["networkGenerations"]+["5G"])]
                    carrier["radioEvidenceSource"]="https://www.ncc.gov.ng/sites/default/files/2026-11/Network-Performance.pdf"
            for operator in operators:
                if norm(operator["name"]) in ng_5g_names and "5G" not in operator["generations"]:
                    operator["generations"]=[g for g in GENS if g in set(operator["generations"]+["5G"])]
            if "5G" not in all_gens: all_gens.append("5G")
            all_gens=sorted(set(all_gens),key=GENS.index)
            source_notes.append("NCC/Ookla recorded 5G-capable device activity using 5G on MTN, Airtel, T2 (formerly 9mobile) and Glo in Lagos and Abuja in August 2026. T2's sample was small; this is not a promise of nationwide 5G coverage.")

        local_carriers=[item for item in esim if item.get("providerType")=="local_mobile_carrier"]
        travel_providers=[item for item in esim if item.get("providerType")=="global_travel_esim"]
        updated=[str(r.get("updatedAt")) for r in local if r.get("updatedAt")]
        countries[code]={
            "country":destination["name"],"code":code,
            "esimCarrierCount":len(esim),"esimCarriers":esim,
            "localEsimCarrierCount":len(local_carriers),"localEsimCarriers":local_carriers,
            "travelEsimProviderCount":len(travel_providers),"travelEsimProviders":travel_providers,
            "generations":all_gens,"operatorCount":len(operators),"operators":operators,
            "networkRecordCount":len(local),"networkSourceUpdatedAt":max(updated) if updated else None,
            "networkDataVerified":bool(all_gens),"sourceNotes":source_notes
        }
        override=TERRITORY_NETWORK_OVERRIDES.get(code)
        if override:
            all_gens=override["generations"]
            operators=override["operators"]
            source_notes.append(override["note"])
            for carrier in esim:
                carrier["radioEvidenceSource"]=override["source"]
            # Replace the arrays in the country record with the territory-specific evidence.
            local_carriers=[item for item in esim if item.get("providerType")=="local_mobile_carrier"]
            travel_providers=[item for item in esim if item.get("providerType")=="global_travel_esim"]
            updated=[str(r.get("updatedAt")) for r in local if r.get("updatedAt")]
            countries[code]={
                "country":destination["name"],"code":code,
                "esimCarrierCount":len(esim),"esimCarriers":esim,
                "localEsimCarrierCount":len(local_carriers),"localEsimCarriers":local_carriers,
                "travelEsimProviderCount":len(travel_providers),"travelEsimProviders":travel_providers,
                "generations":all_gens,"operatorCount":len(operators),"operators":operators,
                "networkRecordCount":len(local),"networkSourceUpdatedAt":max(updated) if updated else None,
                "networkDataVerified":bool(all_gens),"sourceNotes":source_notes,
                "networkOverrideSource":override["source"]
            }


    now=dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    data={
      "schemaVersion":1,"generatedAt":now,"destinationCount":len(rows),
      "sources":{
        "esimCarriers":{"name":"Apple Support eSIM wireless carrier directory","url":APPLE,
          "publishedDate":apple_date,"scope":"Local wireless carriers listed by Apple as supporting eSIM activation on iPhone; device, plan and activation eligibility may vary."},
        "mobileNetworks":{"name":"MCC-MNC.org Networks API","url":MCC,
          "license":"Free for commercial and non-commercial use; attribute mcc-mnc.org",**network_meta},
        "airaloLocalDirectory":{"name":"Airalo Local eSIM catalogue","url":"https://www.airalo.com/local-esim","scope":"Country destinations explicitly listed in Airalo's Local eSIM catalogue; no plan prices are copied into this app."},
        "territoryNetworkOverrides":{"scope":"Source-specific radio-generation records for destinations missing from MCC-MNC's country list; the source and caveat are attached per country."},
        "nigeriaRadioEnrichment":{"name":"Nigerian Communications Commission and Ookla — Network Performance Report","url":"https://www.ncc.gov.ng/sites/default/files/2026-11/Network-Performance.pdf","scope":"Observed 5G-capable device activity using 5G by operator in Lagos and Abuja, August 2026; T2 sample is small."}
      },
      "globalTravelProviders":global_providers,"countries":countries
    }
    (OUT/"country-carrier-data.json").write_text(json.dumps(data,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    provider_count=sum(bool(x["esimCarrierCount"]) for x in countries.values())
    local_provider_count=sum(bool(x["localEsimCarrierCount"]) for x in countries.values())
    travel_provider_count=sum(bool(x["travelEsimProviderCount"]) for x in countries.values())
    speed_count=sum(x["networkDataVerified"] for x in countries.values())
    status={
      "generatedAt":now,"destinationCount":len(rows),"countriesWithAppleListedEsimProviders":provider_count,
      "countriesWithoutAppleListedEsimProviders":len(rows)-provider_count,
      "countriesWithAppleListedLocalCarriers":local_provider_count,
      "countriesWithAppleListedTravelProviders":travel_provider_count,
      "countriesWithNetworkGenerations":speed_count,"countriesWithoutNetworkGenerations":len(rows)-speed_count,
      "appleGlobalTravelProviders":len(global_providers),"mccNetworkRecords":len(networks),
      "applePublishedDate":apple_date,
      "sampleNigeria":countries.get("NG")
    }
    (OUT/"country-carrier-status.json").write_text(json.dumps(status,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(status,ensure_ascii=False))
    if provider_count<1 or speed_count<100: raise RuntimeError("Source coverage audit failed")

if __name__=="__main__":
    main()
