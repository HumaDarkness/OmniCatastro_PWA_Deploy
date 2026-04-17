import { describe, expect, it, vi } from "vitest";

vi.mock("../supabase", () => ({
    supabase: null,
}));

vi.mock("../kyClient", () => ({
    kyClient: {
        get: vi.fn(),
    },
}));

import { extraerDatosInmuebleUnico } from "../catastroService";

function makeBackendPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        raw_response: {},
        direccion_cruda: "",
        tipo_via: "",
        nombre_via: "",
        numero: "",
        escalera: "",
        planta: "",
        puerta: "",
        bloque: "",
        municipio: "",
        provincia: "",
        codigo_postal: "",
        ...overrides,
    };
}

describe("catastroService address extraction", () => {
    it("keeps visible address up to CP for rural RC regression case", () => {
        const datos = makeBackendPayload({
            direccion_cruda:
                "DS DISEMINADO 7 POLIGONO 2 PARCELA 30014 000100100UK91D LOS ARENALES. 45522 ALBARREAL DE TAJO (TOLEDO)",
            tipo_via: "DS",
            nombre_via: "DISEMINADO 7 POLIGONO 2 PARCELA 30014 000100100UK91D LOS ARENALES",
            codigo_postal: "45522",
            municipio: "ALBARREAL DE TAJO",
            provincia: "TOLEDO",
        });

        const result = extraerDatosInmuebleUnico(datos);

        expect(result.direccion).toContain("POLIGONO 2 PARCELA 30014");
        expect(result.direccion.endsWith("45522")).toBe(true);
        expect(result.direccion.includes("ALBARREAL DE TAJO")).toBe(false);
    });

    it("cuts at first postal code token when codigo_postal field is missing", () => {
        const datos = makeBackendPayload({
            direccion_cruda: "DS DISEMINADO 5 POLIGONO 11 PARCELA 91 12345 MUNICIPIO DEMO",
            tipo_via: "DS",
            nombre_via: "DISEMINADO 5 POLIGONO 11 PARCELA 91",
            codigo_postal: "",
        });

        const result = extraerDatosInmuebleUnico(datos);

        expect(result.direccion).toBe("DS DISEMINADO 5 POLIGONO 11 PARCELA 91 12345");
    });

    it("falls back to structured address when direccion_cruda is unavailable", () => {
        const datos = makeBackendPayload({
            direccion_cruda: "",
            tipo_via: "DS",
            nombre_via: "DISEMINADO 7 POLIGONO 2 PARCELA 30014 000100100UK91D LOS ARENALES",
            numero: "",
            codigo_postal: "45522",
        });

        const result = extraerDatosInmuebleUnico(datos);

        expect(result.direccion.startsWith("DISEMINADO ")).toBe(true);
        expect(result.direccion.includes("DISEMINADO DISEMINADO")).toBe(false);
        expect(result.direccion.includes("000100100UK91D")).toBe(false);
    });

    it("extracts address up to CP from raw Catastro shape (non-backend payload)", () => {
        const datos = {
            consulta_dnprcResult: {
                bico: {
                    bi: {
                        debi: {
                            luso: "Residencial",
                            sfc: "247",
                            ant: "1971",
                        },
                        dt: {
                            nm: "ALBARREAL DE TAJO",
                            np: "TOLEDO",
                            locs: {
                                lous: {
                                    lourb: {
                                        ldt: "DS DISEMINADO 7 POLIGONO 2 PARCELA 30014 LOS ARENALES 45522 ALBARREAL DE TAJO TOLEDO",
                                        dp: "45522",
                                        dir: {
                                            tv: "DS",
                                            nv: "DISEMINADO 7 POLIGONO 2 PARCELA 30014 LOS ARENALES",
                                            pnp: "",
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        };

        const result = extraerDatosInmuebleUnico(datos);

        expect(result.direccion).toBe("DS DISEMINADO 7 POLIGONO 2 PARCELA 30014 LOS ARENALES 45522");
        expect(result.codigoPostal).toBe("45522");
        expect(result.municipio).toBe("ALBARREAL DE TAJO");
        expect(result.provincia).toBe("TOLEDO");
    });

    it("reads rural address from locs.lors branch and cuts at CP", () => {
        const datos = {
            consulta_dnprcResult: {
                bico: {
                    bi: {
                        ldt: "LG MOLINAFERRERA 7(A) 24724 LUCILLO (MOLINAFERRERA) (LEON)",
                        debi: {
                            luso: "Residencial",
                            sfc: "186",
                            ant: "1950",
                        },
                        dt: {
                            nm: "LUCILLO",
                            np: "LEON",
                            locs: {
                                lors: {
                                    lourb: {
                                        dp: "24724",
                                        dir: {
                                            tv: "LG",
                                            nv: "MOLINAFERRERA",
                                            pnp: "7",
                                        },
                                    },
                                    lorus: {
                                        cpp: {
                                            cpo: "0",
                                            cpa: "0",
                                        },
                                        npa: "NC",
                                    },
                                },
                            },
                        },
                    },
                },
            },
        };

        const result = extraerDatosInmuebleUnico(datos);

        expect(result.direccion).toBe("LG MOLINAFERRERA 7(A) 24724");
        expect(result.codigoPostal).toBe("24724");
    });

    it("falls back to bi.ldt when CP is missing but rural address exists", () => {
        const datos = {
            consulta_dnprcResult: {
                bico: {
                    bi: {
                        ldt: "LG GRADEFES Poligono 512 Parcela 5029 MELLANZOS. GRADEFES (GRADEFES) (LEON)",
                        debi: {
                            luso: "Residencial",
                            sfc: "398",
                            ant: "1920",
                        },
                        dt: {
                            nm: "GRADEFES",
                            np: "LEON",
                            locs: {
                                lors: {
                                    lourb: {
                                        dir: {
                                            tv: "LG",
                                            nv: "GRADEFES",
                                            pnp: "",
                                        },
                                    },
                                    lorus: {
                                        cpp: {
                                            cpo: "512",
                                            cpa: "5029",
                                        },
                                        npa: "MELLANZOS",
                                    },
                                },
                            },
                        },
                    },
                },
            },
        };

        const result = extraerDatosInmuebleUnico(datos);

        expect(result.direccion).toContain("POLIGONO 512 PARCELA 5029");
        expect(result.direccion).toContain("MELLANZOS");
        expect(result.codigoPostal).toBe("");
    });

    it("builds rural full address from lorus components when ldt is missing", () => {
        const datos = {
            consulta_dnprcResult: {
                bico: {
                    bi: {
                        debi: {
                            luso: "Residencial",
                            sfc: "247",
                            ant: "1971",
                        },
                        dt: {
                            nm: "ALBARREAL DE TAJO",
                            np: "TOLEDO",
                            locs: {
                                lous: {
                                    lourb: {
                                        dir: {
                                            tv: "DS",
                                            nv: "DISEMINADO",
                                            pnp: "7",
                                            td: "000100100UK91D",
                                        },
                                        loing: {},
                                        dp: "45522",
                                    },
                                    lorus: {
                                        cpp: {
                                            cpo: "2",
                                            cpa: "30014",
                                        },
                                        npa: "LOS ARENALES",
                                    },
                                },
                            },
                        },
                    },
                },
            },
        };

        const result = extraerDatosInmuebleUnico(datos);

        expect(result.direccion).toBe("DISEMINADO 7 POLIGONO 2 PARCELA 30014 000100100UK91D LOS ARENALES 45522");
    });

    it("keeps rural address stable when td is missing", () => {
        const datos = {
            consulta_dnprcResult: {
                bico: {
                    bi: {
                        debi: {
                            luso: "Residencial",
                            sfc: "247",
                            ant: "1971",
                        },
                        dt: {
                            nm: "ALBARREAL DE TAJO",
                            np: "TOLEDO",
                            locs: {
                                lous: {
                                    lourb: {
                                        dir: {
                                            tv: "DS",
                                            nv: "DISEMINADO",
                                            pnp: "7",
                                            td: "",
                                        },
                                        loing: {},
                                        dp: "45522",
                                    },
                                    lorus: {
                                        cpp: {
                                            cpo: "2",
                                            cpa: "30014",
                                        },
                                        npa: "LOS ARENALES",
                                    },
                                },
                            },
                        },
                    },
                },
            },
        };

        const result = extraerDatosInmuebleUnico(datos);

        expect(result.direccion).toBe("DISEMINADO 7 POLIGONO 2 PARCELA 30014 LOS ARENALES 45522");
        expect(result.direccion.includes("  ")).toBe(false);
    });

    it("sanitizes malformed td token in rural fallback", () => {
        const datos = {
            consulta_dnprcResult: {
                bico: {
                    bi: {
                        debi: {
                            luso: "Residencial",
                            sfc: "247",
                            ant: "1971",
                        },
                        dt: {
                            nm: "ALBARREAL DE TAJO",
                            np: "TOLEDO",
                            locs: {
                                lous: {
                                    lourb: {
                                        dir: {
                                            tv: "DS",
                                            nv: "DISEMINADO",
                                            pnp: "7",
                                            td: "000100100UK91D <script>alert</script> ###",
                                        },
                                        loing: {},
                                        dp: "45522",
                                    },
                                    lorus: {
                                        cpp: {
                                            cpo: "2",
                                            cpa: "30014",
                                        },
                                        npa: "LOS ARENALES",
                                    },
                                },
                            },
                        },
                    },
                },
            },
        };

        const result = extraerDatosInmuebleUnico(datos);

        expect(result.direccion).toContain("000100100UK91D");
        expect(result.direccion.includes("SCRIPT")).toBe(false);
        expect(result.direccion.includes("<")).toBe(false);
        expect(result.direccion.includes(">")).toBe(false);
    });

    it("passes synthetic rural stress invariants in batch", () => {
        for (let i = 1; i <= 200; i += 1) {
            const cp = String(45000 + (i % 99)).padStart(5, "0");
            const datos = makeBackendPayload({
                direccion_cruda: `DS DISEMINADO ${i} POLIGONO ${i % 30} PARCELA ${1000 + i} ${cp} MUNICIPIO TEST PROVINCIA TEST`,
                tipo_via: "DS",
                nombre_via: `DISEMINADO ${i} POLIGONO ${i % 30} PARCELA ${1000 + i}`,
                codigo_postal: cp,
            });

            const result = extraerDatosInmuebleUnico(datos);

            expect(result.direccion.endsWith(cp)).toBe(true);
            expect(result.direccion.includes("MUNICIPIO TEST")).toBe(false);
        }
    });
});
