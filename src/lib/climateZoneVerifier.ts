// climateZoneVerifier.ts
export const ZONES_DATA: Record<string, { limit: number; newZone: string }[]> = {
    "Albacete": [{limit: 50, newZone: "C3"}, {limit: 500, newZone: "D3"}, {limit: 1000, newZone: "E1"}, {limit: 1301, newZone: "E1"}],
    "Alicante/Alacant": [{limit: 250, newZone: "B4"}, {limit: 700, newZone: "C3"}, {limit: 1301, newZone: "D3"}],
    "Almería": [{limit: 100, newZone: "A4"}, {limit: 250, newZone: "B4"}, {limit: 400, newZone: "B3"}, {limit: 800, newZone: "C3"}, {limit: 1301, newZone: "D3"}],
    "Araba/Álava": [{limit: 600, newZone: "D1"}, {limit: 1301, newZone: "E1"}],
    "Asturias": [{limit: 50, newZone: "C1"}, {limit: 550, newZone: "D1"}, {limit: 1301, newZone: "E1"}],
    "Ávila": [{limit: 550, newZone: "D2"}, {limit: 850, newZone: "D1"}, {limit: 1301, newZone: "E1"}],
    "Badajoz": [{limit: 400, newZone: "C4"}, {limit: 450, newZone: "C3"}, {limit: 1301, newZone: "D3"}],
    "Balears, Illes": [{limit: 250, newZone: "B3"}, {limit: 1301, newZone: "C3"}],
    "Barcelona": [{limit: 250, newZone: "C2"}, {limit: 450, newZone: "D2"}, {limit: 750, newZone: "D1"}, {limit: 1301, newZone: "E1"}],
    "Bizkaia": [{limit: 250, newZone: "C1"}, {limit: 1301, newZone: "D1"}],
    "Burgos": [{limit: 600, newZone: "D1"}, {limit: 1301, newZone: "E1"}],
    "Cáceres": [{limit: 600, newZone: "C4"}, {limit: 1050, newZone: "D3"}, {limit: 1301, newZone: "E1"}],
    "Cádiz": [{limit: 150, newZone: "A3"}, {limit: 450, newZone: "B3"}, {limit: 600, newZone: "C3"}, {limit: 850, newZone: "C2"}, {limit: 1301, newZone: "D2"}],
    "Cantabria": [{limit: 150, newZone: "C1"}, {limit: 650, newZone: "D1"}, {limit: 1301, newZone: "E1"}],
    "Castellón/Castelló": [{limit: 100, newZone: "B3"}, {limit: 500, newZone: "C3"}, {limit: 600, newZone: "D3"}, {limit: 1000, newZone: "D2"}, {limit: 1301, newZone: "E1"}],
    "Ceuta": [{limit: 1301, newZone: "B3"}],
    "Ciudad Real": [{limit: 450, newZone: "C4"}, {limit: 500, newZone: "C3"}, {limit: 1301, newZone: "D3"}],
    "Córdoba": [{limit: 150, newZone: "B4"}, {limit: 550, newZone: "C4"}, {limit: 1301, newZone: "D3"}],
    "Coruña, A": [{limit: 200, newZone: "C1"}, {limit: 1301, newZone: "D1"}],
    "Cuenca": [{limit: 800, newZone: "D3"}, {limit: 1050, newZone: "D2"}, {limit: 1301, newZone: "E1"}],
    "Gipuzkoa": [{limit: 400, newZone: "D1"}, {limit: 1301, newZone: "E1"}],
    "Girona": [{limit: 100, newZone: "C2"}, {limit: 600, newZone: "D2"}, {limit: 1301, newZone: "E1"}],
    "Granada": [{limit: 50, newZone: "A4"}, {limit: 350, newZone: "B4"}, {limit: 600, newZone: "C4"}, {limit: 800, newZone: "C3"}, {limit: 1250, newZone: "D3"}, {limit: 1301, newZone: "E1"}],
    "Guadalajara": [{limit: 950, newZone: "D3"}, {limit: 1000, newZone: "D2"}, {limit: 1301, newZone: "E1"}],
    "Huelva": [{limit: 50, newZone: "A4"}, {limit: 150, newZone: "B4"}, {limit: 350, newZone: "B3"}, {limit: 800, newZone: "C3"}, {limit: 1301, newZone: "D3"}],
    "Huesca": [{limit: 200, newZone: "C3"}, {limit: 400, newZone: "D3"}, {limit: 700, newZone: "D2"}, {limit: 1301, newZone: "E1"}],
    "Jaén": [{limit: 350, newZone: "B4"}, {limit: 750, newZone: "C4"}, {limit: 1250, newZone: "D3"}, {limit: 1301, newZone: "E1"}],
    "León": [{limit: 1301, newZone: "E1"}],
    "Lleida": [{limit: 100, newZone: "C3"}, {limit: 600, newZone: "D3"}, {limit: 1301, newZone: "E1"}],
    "Lugo": [{limit: 500, newZone: "D1"}, {limit: 1301, newZone: "E1"}],
    "Madrid": [{limit: 500, newZone: "C3"}, {limit: 950, newZone: "D3"}, {limit: 1000, newZone: "D2"}, {limit: 1301, newZone: "E1"}],
    "Málaga": [{limit: 100, newZone: "A3"}, {limit: 300, newZone: "B3"}, {limit: 700, newZone: "C3"}, {limit: 1301, newZone: "D3"}],
    "Melilla": [{limit: 1301, newZone: "A3"}],
    "Murcia": [{limit: 100, newZone: "B3"}, {limit: 550, newZone: "C3"}, {limit: 1301, newZone: "D3"}],
    "Navarra": [{limit: 100, newZone: "C2"}, {limit: 350, newZone: "D2"}, {limit: 600, newZone: "D1"}, {limit: 1301, newZone: "E1"}],
    "Ourense": [{limit: 150, newZone: "C3"}, {limit: 300, newZone: "C2"}, {limit: 800, newZone: "D2"}, {limit: 1301, newZone: "E1"}],
    "Palencia": [{limit: 800, newZone: "D1"}, {limit: 1301, newZone: "E1"}],
    "Palmas, Las": [{limit: 350, newZone: "alpha3"}, {limit: 750, newZone: "A2"}, {limit: 1000, newZone: "B2"}, {limit: 1301, newZone: "C2"}],
    "Pontevedra": [{limit: 350, newZone: "C1"}, {limit: 1301, newZone: "D1"}],
    "Rioja, La": [{limit: 200, newZone: "C2"}, {limit: 700, newZone: "D2"}, {limit: 1301, newZone: "E1"}],
    "Salamanca": [{limit: 850, newZone: "D2"}, {limit: 1301, newZone: "E1"}],
    "Santa Cruz de Tenerife": [{limit: 350, newZone: "alpha3"}, {limit: 750, newZone: "A2"}, {limit: 1000, newZone: "B2"}, {limit: 1301, newZone: "C2"}],
    "Segovia": [{limit: 1050, newZone: "D2"}, {limit: 1301, newZone: "E1"}],
    "Sevilla": [{limit: 200, newZone: "B4"}, {limit: 1301, newZone: "C4"}],
    "Soria": [{limit: 750, newZone: "D2"}, {limit: 800, newZone: "D1"}, {limit: 1301, newZone: "E1"}],
    "Tarragona": [{limit: 100, newZone: "B3"}, {limit: 500, newZone: "C3"}, {limit: 1301, newZone: "D3"}],
    "Teruel": [{limit: 450, newZone: "C3"}, {limit: 500, newZone: "C2"}, {limit: 1000, newZone: "D2"}, {limit: 1301, newZone: "E1"}],
    "Toledo": [{limit: 500, newZone: "C4"}, {limit: 1301, newZone: "D3"}],
    "Valencia/València": [{limit: 50, newZone: "B3"}, {limit: 500, newZone: "C3"}, {limit: 950, newZone: "D2"}, {limit: 1301, newZone: "E1"}],
    "Valladolid": [{limit: 800, newZone: "D2"}, {limit: 1301, newZone: "E1"}],
    "Zamora": [{limit: 800, newZone: "D2"}, {limit: 1301, newZone: "E1"}],
    "Zaragoza": [{limit: 200, newZone: "C3"}, {limit: 650, newZone: "D3"}, {limit: 1301, newZone: "E1"}],
};

export const PROVINCE_ALIASES: Record<string, string> = {
    "albacete": "Albacete",
    "alicante/alacant": "Alicante/Alacant",
    "alicante": "Alicante/Alacant",
    "alacant": "Alicante/Alacant",
    "almeria": "Almería",
    "araba/alava": "Araba/Álava",
    "araba": "Araba/Álava",
    "alava": "Araba/Álava",
    "asturias": "Asturias",
    "avila": "Ávila",
    "badajoz": "Badajoz",
    "balears, illes": "Balears, Illes",
    "illes balears": "Balears, Illes",
    "balears": "Balears, Illes",
    "barcelona": "Barcelona",
    "bizkaia": "Bizkaia",
    "burgos": "Burgos",
    "caceres": "Cáceres",
    "cadiz": "Cádiz",
    "cantabria": "Cantabria",
    "castellon/castello": "Castellón/Castelló",
    "castellon": "Castellón/Castelló",
    "castello": "Castellón/Castelló",
    "ceuta": "Ceuta",
    "ciudad real": "Ciudad Real",
    "cordoba": "Córdoba",
    "coruna, a": "Coruña, A",
    "a coruna": "Coruña, A",
    "coruna": "Coruña, A",
    "cuenca": "Cuenca",
    "gipuzkoa": "Gipuzkoa",
    "girona": "Girona",
    "granada": "Granada",
    "guadalajara": "Guadalajara",
    "huelva": "Huelva",
    "huesca": "Huesca",
    "jaen": "Jaén",
    "leon": "León",
    "lleida": "Lleida",
    "lugo": "Lugo",
    "madrid": "Madrid",
    "malaga": "Málaga",
    "melilla": "Melilla",
    "murcia": "Murcia",
    "navarra": "Navarra",
    "ourense": "Ourense",
    "palencia": "Palencia",
    "palmas, las": "Palmas, Las",
    "las palmas": "Palmas, Las",
    "palmas": "Palmas, Las",
    "pontevedra": "Pontevedra",
    "rioja, la": "Rioja, La",
    "la rioja": "Rioja, La",
    "rioja": "Rioja, La",
    "salamanca": "Salamanca",
    "santa cruz de tenerife": "Santa Cruz de Tenerife",
    "segovia": "Segovia",
    "sevilla": "Sevilla",
    "soria": "Soria",
    "tarragona": "Tarragona",
    "teruel": "Teruel",
    "toledo": "Toledo",
    "valencia/valencia": "Valencia/València",
    "valencia": "Valencia/València",
    "valladolid": "Valladolid",
    "zamora": "Zamora",
    "zaragoza": "Zaragoza",
};

export function normalizeText(text: string): string {
    if (!text) return "";
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function obtenerZona(provincia: string, altura: number): string | null {
    const cleanInput = normalizeText(provincia);
    const officialKey = PROVINCE_ALIASES[cleanInput];

    if (!officialKey) return null;

    const thresholds = ZONES_DATA[officialKey];
    if (!thresholds) return null;

    for (const { limit, newZone } of thresholds) {
        if (altura <= limit) {
            return newZone;
        }
    }
    return thresholds[thresholds.length - 1].newZone;
}


export async function fetchAltitudeAndProvince(rc: string, prov: string, _muni: string): Promise<{ altitude: number | null, zone: string | null }> {
    if (!rc || rc.length < 14) return { altitude: null, zone: null };
    const rc14 = rc.substring(0, 14);
    
    // Call catastro API to get coordinates (Using AllOrigins proxy to avoid CORS)
    // IMPORTANT: We omit Provincia&Municipio because CE3X municipality names often don't match
    // the exact Catastro registry names, causing "EL MUNICIPIO NO EXISTE" errors.
    // The RC alone is sufficient to identify the property.
    const catastroUrl = `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_CPMRC?Provincia=&Municipio=&SRS=EPSG:4258&RC=${encodeURIComponent(rc14)}`;
    const url = `https://api.allorigins.win/raw?url=${encodeURIComponent(catastroUrl)}`;
    
    let lat: number | null = null;
    let lon: number | null = null;
    
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("API call failed");
        const xmlData = await response.text();
        
        // 1. Intentar buscar <lat> y <lon> explícitos
        const latMatch = xmlData.match(/<lat>([\d\.-]+)<\/lat>/);
        const lonMatch = xmlData.match(/<lon>([\d\.-]+)<\/lon>/);
        
        if (latMatch && lonMatch) {
            lat = parseFloat(latMatch[1]);
            lon = parseFloat(lonMatch[1]);
        } else {
            // 2. Intentar buscar <xcen> y <ycen> (muy común en respuestas de Catastro)
            const xcenMatch = xmlData.match(/<xcen>([\d\.-]+)<\/xcen>/);
            const ycenMatch = xmlData.match(/<ycen>([\d\.-]+)<\/ycen>/);
            
            if (xcenMatch && ycenMatch) {
                const x = parseFloat(xcenMatch[1]);
                const y = parseFloat(ycenMatch[1]);
                
                // Si los valores son pequeños (< 180), son geográficas directas (ETRS89 ~ WGS84)
                if (Math.abs(x) < 180 && Math.abs(y) < 90) {
                    lon = x;
                    lat = y;
                } else {
                    // Son coordenadas UTM. Por ahora, si no tenemos conversor robusto JS (proj4),
                    // avisaremos o intentaremos un fallback. 
                    // En la mayoría de casos urbanos, Catastro devuelve geográficas si se pide EPSG:4258.
                    console.warn("Detected UTM coordinates but no JS converter is present. Altitude might fail.");
                }
            } else {
                // 3. Fallback <geo>x,y</geo>
                const geoMatch = xmlData.match(/<geo>([\d\.-]+),([\d\.-]+)<\/geo>/);
                if (geoMatch) {
                    lat = parseFloat(geoMatch[1]);
                    lon = parseFloat(geoMatch[2]);
                }
            }
        }

        if (lat === null || lon === null) {
            console.warn("Could not determine lat/lon from catastro response.");
            return { altitude: null, zone: null };
        }
        
        // Call open-meteo (Elevation API)
        const elevUrl = `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`;
        const elevResponse = await fetch(elevUrl);
        if (!elevResponse.ok) throw new Error("Elevation API call failed");
        
        const elevData = await elevResponse.json();
        
        let altitude: number | null = null;
        if (elevData.elevation && elevData.elevation.length > 0) {
            altitude = Math.round(elevData.elevation[0]);
        }
        
        let zone: string | null = null;
        if (altitude !== null) {
            zone = obtenerZona(prov, altitude);
        }
        
        return { altitude, zone };
        
    } catch(err) {
        console.error("Error fetching altitude: ", err);
        return { altitude: null, zone: null };
    }
}
