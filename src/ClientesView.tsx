import { useState, useRef, useMemo, useEffect } from "react";
import { Users, Plus, UploadCloud, Save, ChevronLeft, Image as ImageIcon, Search, Trash2, CloudDownload, Loader2 } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type ClienteLocal } from "./infra/db/OmniCatastroDB";
import { clientAggregateV1Repository } from "./infra/clients";
import { clientSyncService } from "./lib/clientSyncService";
import { getCurrentOrganizationId, supabase } from "./lib/supabase";

function normalizeClientSearch(value: string): string {
    return value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "");
}

function pickFirstString(row: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
        const value = row[key];
        if (typeof value === "string") {
            const normalized = value.trim();
            if (normalized.length > 0) return normalized;
        }
    }
    return undefined;
}

function normalizeNifKey(value: string): string {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeRcKey(value: string): string {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function splitNameFromFullName(fullName: string): { nombre: string; apellidos: string } {
    const normalized = fullName.replace(/\s+/g, " ").trim();
    if (!normalized) {
        return { nombre: "", apellidos: "" };
    }

    const parts = normalized.split(" ");
    if (parts.length <= 1) {
        return { nombre: normalized, apellidos: "" };
    }

    return {
        nombre: parts[0],
        apellidos: parts.slice(1).join(" "),
    };
}

interface StorageLocator {
    bucket: string;
    path: string;
}

function parseStorageLocator(rawPath?: string | null): StorageLocator | undefined {
    if (!rawPath) return undefined;

    let value = rawPath.trim();
    if (!value) return undefined;

    value = value.replace(/\\/g, "/");

    const isHttpUrl = /^https?:\/\//i.test(value);
    try {
        if (isHttpUrl) {
            value = decodeURIComponent(new URL(value).pathname);
        }
    } catch {
        // Ignore URL parsing errors and keep original value.
    }

    value = value.split("?")[0].split("#")[0];

    const prefixed = value.match(/^([a-z0-9_-]+):(.*)$/i);
    if (prefixed) {
        const bucket = prefixed[1].toLowerCase();
        const path = prefixed[2].replace(/^\/+/, "");
        if (path && (bucket === "documents" || bucket === "work_photos")) {
            return { bucket, path };
        }
    }

    const markers: Array<{ bucket: string; marker: string }> = [
        { bucket: "documents", marker: "/storage/v1/object/public/documents/" },
        { bucket: "documents", marker: "/storage/v1/object/sign/documents/" },
        { bucket: "documents", marker: "/object/public/documents/" },
        { bucket: "documents", marker: "/object/sign/documents/" },
        { bucket: "documents", marker: "/public/documents/" },
        { bucket: "documents", marker: "/documents/" },
        { bucket: "documents", marker: "documents/" },
        { bucket: "work_photos", marker: "/storage/v1/object/public/work_photos/" },
        { bucket: "work_photos", marker: "/storage/v1/object/sign/work_photos/" },
        { bucket: "work_photos", marker: "/object/public/work_photos/" },
        { bucket: "work_photos", marker: "/object/sign/work_photos/" },
        { bucket: "work_photos", marker: "/public/work_photos/" },
        { bucket: "work_photos", marker: "/work_photos/" },
        { bucket: "work_photos", marker: "work_photos/" },
    ];

    const lower = value.toLowerCase();
    for (const { bucket, marker } of markers) {
        const markerLower = marker.toLowerCase();
        const idx = lower.indexOf(markerLower);
        if (idx >= 0) {
            const path = value.slice(idx + marker.length).replace(/^\/+/, "");
            if (path) return { bucket, path };
        }
    }

    const trimmed = value.replace(/^\/+/, "");
    if (!trimmed) return undefined;

    const slashIdx = trimmed.indexOf("/");
    if (slashIdx > 0) {
        const firstSegment = trimmed.slice(0, slashIdx).toLowerCase();
        const rest = trimmed.slice(slashIdx + 1).replace(/^\/+/, "");
        if ((firstSegment === "documents" || firstSegment === "work_photos") && rest) {
            return { bucket: firstSegment, path: rest };
        }
    }

    return { bucket: "documents", path: trimmed };
}

export function ClientesView() {
    const clients = useLiveQuery(async () => {
        try {
            return await db.clientes.orderBy('nombre').toArray();
        } catch {
            // Fallback si el índice nombre no existe en registros antiguos
            return await db.clientes.toArray();
        }
    }) || [];
    
    const [editingClient, setEditingClient] = useState<Partial<ClienteLocal> | null>(null);
    const [clientSearch, setClientSearch] = useState("");
    const [syncingCloud, setSyncingCloud] = useState(false);
    const [syncMsg, setSyncMsg] = useState<string | null>(null);
    const autoCloudSyncRef = useRef(false);

    const [localFrontPreview, setLocalFrontPreview] = useState<string | null>(null);
    const [localBackPreview, setLocalBackPreview] = useState<string | null>(null);

    const frontInputRef = useRef<HTMLInputElement>(null);
    const backInputRef = useRef<HTMLInputElement>(null);

    async function downloadClientBlob(path?: string | null): Promise<Blob | undefined> {
        if (!supabase) return undefined;
        const locator = parseStorageLocator(path);
        if (!locator) return undefined;

        const primary = await supabase.storage.from(locator.bucket).download(locator.path);
        if (!primary.error && primary.data) {
            return primary.data;
        }

        if (locator.bucket === "documents") {
            const fallback = await supabase.storage.from("work_photos").download(locator.path);
            if (!fallback.error && fallback.data) return fallback.data;
        } else if (locator.bucket === "work_photos") {
            const fallback = await supabase.storage.from("documents").download(locator.path);
            if (!fallback.error && fallback.data) return fallback.data;
        }

        return undefined;
    }

    async function downloadFirstAvailableBlob(
        paths: Array<string | undefined>,
        options?: { maxAttempts?: number },
    ): Promise<Blob | undefined> {
        const seen = new Set<string>();
        const maxAttempts = options?.maxAttempts ?? Number.POSITIVE_INFINITY;
        let attempts = 0;

        for (const path of paths) {
            const locator = parseStorageLocator(path);
            if (!locator) continue;

            const key = `${locator.bucket}:${locator.path}`;
            if (seen.has(key)) continue;
            seen.add(key);

            attempts += 1;
            if (attempts > maxAttempts) break;

            const blob = await downloadClientBlob(`${locator.bucket}:${locator.path}`);
            if (blob) return blob;
        }
        return undefined;
    }

    async function dataUrlToBlob(dataUrl?: string): Promise<Blob | undefined> {
        if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return undefined;
        try {
            const response = await fetch(dataUrl);
            if (!response.ok) return undefined;
            return await response.blob();
        } catch {
            return undefined;
        }
    }

    async function readWorkPhotosTextByCandidates(candidates: string[]): Promise<string | null> {
        if (!supabase) return null;
        for (const candidate of candidates) {
            const { data, error } = await supabase.storage.from("work_photos").download(candidate);
            if (!error && data) {
                try {
                    return await data.text();
                } catch {
                    // Continue to next candidate.
                }
            }
        }
        return null;
    }

    async function listDraftRcCandidates(folderPath: string): Promise<string[]> {
        if (!supabase) return [];

        const candidates = new Set<string>();
        const pageSize = 200;
        let offset = 0;

        while (true) {
            const { data, error } = await supabase.storage.from("work_photos").list(folderPath, {
                limit: pageSize,
                offset,
                sortBy: { column: "name", order: "asc" },
            });

            if (error || !data || data.length === 0) break;

            for (const entry of data) {
                const rawName = typeof entry?.name === "string" ? entry.name : "";
                if (!rawName || !rawName.endsWith(".json")) continue;
                if (rawName === "_index.json" || rawName === "_archived_index.json" || rawName === "_import_audit.json") {
                    continue;
                }

                const stem = rawName.slice(0, -5);
                const rcCandidate = stem.startsWith("cert_") ? stem.slice(5) : stem;
                const normalizedRc = normalizeRcKey(rcCandidate);
                if (normalizedRc) candidates.add(normalizedRc);
            }

            if (data.length < pageSize) break;
            offset += pageSize;
        }

        return Array.from(candidates.values());
    }

    async function loadDniBlobsFromDrafts(
        organizationId: string,
        targetNifKeys: Set<string>,
        options?: { silent?: boolean },
    ): Promise<Map<string, { front?: Blob; back?: Blob }>> {
        const result = new Map<string, { front?: Blob; back?: Blob }>();
        if (!supabase || targetNifKeys.size === 0) return result;

        const rcSet = new Set<string>();

        const indexText = await readWorkPhotosTextByCandidates([
            `${organizationId}/certificados/_index.json`,
            `certificados/${organizationId}/_index.json`,
        ]);

        if (indexText) {
            try {
                const parsed = JSON.parse(indexText) as Array<Record<string, unknown>>;
                if (Array.isArray(parsed)) {
                    for (const item of parsed) {
                        const dniKey = normalizeNifKey(String(item?.clienteDni ?? ""));
                        if (!dniKey || !targetNifKeys.has(dniKey)) continue;
                        const rc = normalizeRcKey(String(item?.rc ?? ""));
                        if (rc) rcSet.add(rc);
                    }
                }
            } catch {
                // Continue with folder listing fallback.
            }
        }

        if (rcSet.size === 0) {
            const folderCandidates = [`${organizationId}/certificados`, `certificados/${organizationId}`];
            for (const folder of folderCandidates) {
                const rcCandidates = await listDraftRcCandidates(folder);
                for (const rc of rcCandidates) {
                    rcSet.add(rc);
                }
            }
        }

        if (!options?.silent) {
            setSyncMsg(`Sin DNI en documents. Revisando borradores cloud (${rcSet.size})...`);
        }

        const rcCandidates = Array.from(rcSet.values());
        for (let i = 0; i < rcCandidates.length; i += 1) {
            const rc = rcCandidates[i];

            const draftText = await readWorkPhotosTextByCandidates([
                `${organizationId}/certificados/${rc}.json`,
                `${organizationId}/certificados/cert_${rc}.json`,
                `certificados/${organizationId}/${rc}.json`,
                `certificados/${organizationId}/cert_${rc}.json`,
            ]);

            if (!draftText) continue;

            let parsed: Record<string, unknown> | null = null;
            try {
                parsed = JSON.parse(draftText) as Record<string, unknown>;
            } catch {
                parsed = null;
            }
            if (!parsed) continue;

            const dniKey = normalizeNifKey(String(parsed.clienteDni ?? ""));
            if (!dniKey || !targetNifKeys.has(dniKey)) continue;

            const current = result.get(dniKey) || {};
            const captures = (parsed.capturas as Record<string, unknown> | undefined) || undefined;
            const frontDataUrl = typeof (captures?.dni_cliente as Record<string, unknown> | undefined)?.dataUrl === "string"
                ? String((captures?.dni_cliente as Record<string, unknown>).dataUrl)
                : undefined;
            const backDataUrl = typeof (captures?.dni_cliente_back as Record<string, unknown> | undefined)?.dataUrl === "string"
                ? String((captures?.dni_cliente_back as Record<string, unknown>).dataUrl)
                : undefined;

            if (!current.front && frontDataUrl) {
                current.front = await dataUrlToBlob(frontDataUrl);
            }
            if (!current.back && backDataUrl) {
                current.back = await dataUrlToBlob(backDataUrl);
            }

            if (current.front || current.back) {
                result.set(dniKey, current);
            }

            if (!options?.silent && i > 0 && i % 20 === 0) {
                setSyncMsg(`Revisando borradores cloud... ${i}/${rcCandidates.length}`);
            }
        }

        return result;
    }

    async function syncCloudClientsToLocal(options?: { silent?: boolean }) {
        if (syncingCloud) return;

        setSyncingCloud(true);
        if (!options?.silent) {
            setSyncMsg("Sincronizando clientes desde la nube...");
        }

        try {
            if (!supabase) {
                setSyncMsg("Supabase no está configurado en esta sesión.");
                return;
            }

            const organizationId = await getCurrentOrganizationId();
            if (!organizationId) {
                setSyncMsg("No se encontró organización activa para sincronizar clientes.");
                return;
            }

            let query = supabase
                .from("clients")
                .select("*")
                .limit(500);

            if (organizationId) {
                query = query.eq("organization_id", organizationId);
            }

            let { data, error } = await query;

            // Compatibilidad con esquemas legacy sin organization_id en clients.
            if (error && /organization_id/i.test(error.message || "")) {
                const retry = await supabase
                    .from("clients")
                    .select("*")
                    .limit(500);
                data = retry.data;
                error = retry.error;
            }

            if (error) {
                throw error;
            }

            let cloudClients = (data ?? []) as Array<Record<string, unknown>>;

            // Fallback de lectura canónica v1 para escenarios de cutover o tablas legacy vacías.
            if (cloudClients.length === 0) {
                try {
                    const v1Items = await clientAggregateV1Repository.search({
                        limit: 500,
                        includeDeleted: false,
                    });

                    if (v1Items.length > 0) {
                        cloudClients = v1Items.map((item) => {
                            const parsedName = splitNameFromFullName(item.fullName);
                            return {
                                dni: item.dniNumber,
                                first_name: parsedName.nombre,
                                last_name_1: parsedName.apellidos,
                            } as Record<string, unknown>;
                        });

                        if (!options?.silent) {
                            setSyncMsg(`Sincronizando clientes desde origen canónico v1 (${v1Items.length})...`);
                        }
                    }
                } catch {
                    // Si v1 aún no está desplegado para este tenant, se mantiene el flujo legacy sin bloquear.
                }
            }

            if (cloudClients.length === 0) {
                if (!options?.silent) {
                    setSyncMsg("No hay clientes en la nube para importar.");
                }
                return;
            }

            const localClientsSnapshot = await db.clientes.toArray();
            const localByNifKey = new Map<string, ClienteLocal>();
            for (const localClient of localClientsSnapshot) {
                const key = normalizeNifKey(localClient.nif || "");
                if (!key) continue;
                localByNifKey.set(key, localClient);
            }

            const targetNifKeys = new Set<string>();
            for (const cloudClient of cloudClients) {
                const nif = pickFirstString(cloudClient, ["dni", "nif", "document_id", "documento"]) || "";
                const nifKey = normalizeNifKey(nif);
                if (!nifKey) continue;
                const localClient = localByNifKey.get(nifKey);
                const needsDniRecovery = !localClient?.dniBlobFront || !localClient?.dniBlobBack;
                if (needsDniRecovery) {
                    targetNifKeys.add(nifKey);
                }
            }

            const dniPathIndex = new Map<string, { front?: string; back?: string }>();
            let indexedDniFiles = 0;
            const indexTargets: Array<{ bucket: "documents" | "work_photos"; prefix: string }> = [
                { bucket: "documents", prefix: `${organizationId}/clients` },
                { bucket: "documents", prefix: "[object Promise]/clients" },
                { bucket: "documents", prefix: "clients" },
                { bucket: "work_photos", prefix: `${organizationId}/clients` },
                { bucket: "work_photos", prefix: "[object Promise]/clients" },
                { bucket: "work_photos", prefix: "clients" },
            ];
            const listErrors: string[] = [];
            let listedPrefixCount = 0;

            for (const target of indexTargets) {
                const listed = await supabase.storage.from(target.bucket).list(target.prefix, {
                    limit: 1000,
                    offset: 0,
                    sortBy: { column: "name", order: "asc" },
                });

                if (listed.error) {
                    listErrors.push(`${target.bucket}/${target.prefix}: ${listed.error.message}`);
                    continue;
                }

                listedPrefixCount += 1;

                for (const file of listed.data ?? []) {
                    if (!file?.name) continue;

                    const baseName = file.name.replace(/\.[^.]+$/, "");
                    let side: "front" | "back" | null = null;
                    if (/_front$/i.test(baseName) || /_anverso$/i.test(baseName)) side = "front";
                    if (/_back$/i.test(baseName) || /_reverso$/i.test(baseName)) side = "back";
                    if (!side) continue;

                    const nifPart = baseName
                        .replace(/(_front|_back)$/i, "")
                        .replace(/(_anverso|_reverso)$/i, "");

                    const nifKey = normalizeNifKey(nifPart);
                    if (!nifKey) continue;

                    const fullPath = `${target.prefix}/${file.name}`
                        .replace(/\\/g, "/")
                        .replace(/^\/+/, "")
                        .replace(/\/{2,}/g, "/");

                    const current = dniPathIndex.get(nifKey) || {};
                    if (!current[side]) {
                        current[side] = `${target.bucket}:${fullPath}`;
                    }
                    dniPathIndex.set(nifKey, current);
                    indexedDniFiles += 1;
                }
            }

            let processedCount = 0;
            let importedCount = 0;
            let withDniImages = 0;
            let unchangedCount = 0;
            const shouldUseHeuristicPaths = indexedDniFiles > 0;
            const draftDniMap = (!shouldUseHeuristicPaths && targetNifKeys.size > 0)
                ? await loadDniBlobsFromDrafts(organizationId, targetNifKeys, options)
                : new Map<string, { front?: Blob; back?: Blob }>();

            for (const cloudClient of cloudClients) {
                const nif = pickFirstString(cloudClient, ["dni", "nif", "document_id", "documento"])?.toUpperCase() || "";
                if (!nif) continue;
                const nifKey = normalizeNifKey(nif);
                const localClient = localByNifKey.get(nifKey);

                processedCount += 1;

                const nombre = [
                    pickFirstString(cloudClient, ["first_name", "nombre"]),
                    pickFirstString(cloudClient, ["middle_name", "second_name", "nombre_2"]),
                ]
                    .filter(Boolean)
                    .join(" ")
                    .replace(/\s+/g, " ")
                    .trim();

                const apellidos = [
                    pickFirstString(cloudClient, ["last_name_1", "apellido_1", "surname"]),
                    pickFirstString(cloudClient, ["last_name_2", "apellido_2"]),
                ]
                    .filter(Boolean)
                    .join(" ")
                    .replace(/\s+/g, " ")
                    .trim();

                const email = pickFirstString(cloudClient, ["email", "email_address", "correo", "mail"]);
                const telefono = pickFirstString(cloudClient, ["phone", "telefono", "phone_number", "mobile"]);
                const indexedPaths = dniPathIndex.get(nifKey);

                const dniFrontPath = pickFirstString(cloudClient, [
                    "dni_front_path",
                    "dni_anverso_path",
                    "dni_front",
                    "dni_front_url",
                    "dni_anverso_url",
                ]);
                const dniBackPath = pickFirstString(cloudClient, [
                    "dni_back_path",
                    "dni_reverso_path",
                    "dni_back",
                    "dni_back_url",
                    "dni_reverso_url",
                ]);

                const nifLower = nif.toLowerCase();

                const frontCandidates: Array<string | undefined> = [
                    dniFrontPath,
                    indexedPaths?.front,
                ];
                const backCandidates: Array<string | undefined> = [
                    dniBackPath,
                    indexedPaths?.back,
                ];

                // Evita "bucles" de cientos de descargas cuando no hay indexación de archivos DNI.
                if (shouldUseHeuristicPaths) {
                    frontCandidates.push(
                        `documents:${organizationId}/clients/${nif}_front.jpg`,
                        `work_photos:${organizationId}/clients/${nif}_front.jpg`,
                        `${organizationId}/clients/${nif}_front.jpg`,
                        `${organizationId}/clients/${nif}_front.png`,
                        `${organizationId}/clients/${nif}_anverso.jpg`,
                        `${organizationId}/clients/${nifLower}_front.jpg`,
                        `work_photos:[object Promise]/clients/${nif}_front.jpg`,
                        `work_photos:clients/${nif}_front.jpg`,
                        `[object Promise]/clients/${nif}_front.jpg`,
                        `[object Promise]/clients/${nif}_front.png`,
                        `clients/${nif}_front.jpg`,
                    );
                    backCandidates.push(
                        `documents:${organizationId}/clients/${nif}_back.jpg`,
                        `work_photos:${organizationId}/clients/${nif}_back.jpg`,
                        `${organizationId}/clients/${nif}_back.jpg`,
                        `${organizationId}/clients/${nif}_back.png`,
                        `${organizationId}/clients/${nif}_reverso.jpg`,
                        `${organizationId}/clients/${nifLower}_back.jpg`,
                        `work_photos:[object Promise]/clients/${nif}_back.jpg`,
                        `work_photos:clients/${nif}_back.jpg`,
                        `[object Promise]/clients/${nif}_back.jpg`,
                        `[object Promise]/clients/${nif}_back.png`,
                        `clients/${nif}_back.jpg`,
                    );
                }

                const existingFront = localClient?.dniBlobFront;
                const existingBack = localClient?.dniBlobBack;

                const [dniBlobFront, dniBlobBack] = await Promise.all([
                    existingFront
                        ? Promise.resolve(existingFront)
                        : downloadFirstAvailableBlob(frontCandidates, { maxAttempts: shouldUseHeuristicPaths ? 3 : 1 }),
                    existingBack
                        ? Promise.resolve(existingBack)
                        : downloadFirstAvailableBlob(backCandidates, { maxAttempts: shouldUseHeuristicPaths ? 3 : 1 }),
                ]);

                const draftFallback = draftDniMap.get(nifKey);
                const finalDniBlobFront = dniBlobFront ?? draftFallback?.front;
                const finalDniBlobBack = dniBlobBack ?? draftFallback?.back;

                const normalizedNombre = nombre || nif;
                const normalizedEmail = email || undefined;
                const normalizedTelefono = telefono || undefined;

                const hasNewFront = !!finalDniBlobFront && !existingFront;
                const hasNewBack = !!finalDniBlobBack && !existingBack;
                const metadataChanged = !localClient
                    || localClient.nombre !== normalizedNombre
                    || localClient.apellidos !== apellidos
                    || localClient.email !== normalizedEmail
                    || localClient.telefono !== normalizedTelefono
                    || localClient.fuenteOrigen !== "crm";

                const shouldPersist = metadataChanged || hasNewFront || hasNewBack || !localClient?.syncedAt;

                if (shouldPersist) {
                    await db.upsertCliente({
                        nif,
                        nombre: normalizedNombre,
                        apellidos,
                        email: normalizedEmail,
                        telefono: normalizedTelefono,
                        fuenteOrigen: "crm",
                        syncedAt: Date.now(),
                        ...(finalDniBlobFront ? { dniBlobFront: finalDniBlobFront } : {}),
                        ...(finalDniBlobBack ? { dniBlobBack: finalDniBlobBack } : {}),
                    });
                    importedCount += 1;
                } else {
                    unchangedCount += 1;
                }

                if (finalDniBlobFront || finalDniBlobBack) {
                    withDniImages += 1;
                }

                if (!options?.silent && processedCount % 50 === 0) {
                    setSyncMsg(`Sincronizando clientes... ${processedCount}/${cloudClients.length} (actualizados: ${importedCount}).`);
                }
            }

            const imageHint = withDniImages === 0
                ? listErrors.length > 0
                    ? ` No se pudo listar Storage en algunos prefijos (${listErrors[0]}).`
                    : indexedDniFiles === 0
                        ? " No se detectaron archivos DNI en documents/work_photos ({org}/clients)."
                        : ""
                : "";
            const listedHint = listedPrefixCount > 0 ? ` Prefijos indexados: ${listedPrefixCount}.` : "";
            setSyncMsg(`Clientes revisados: ${processedCount}. Actualizados local: ${importedCount}. Sin cambios: ${unchangedCount}. Con imágenes DNI: ${withDniImages}.${imageHint}${listedHint}`);
        } catch (error: any) {
            setSyncMsg(`No se pudo sincronizar clientes desde la nube: ${error?.message ?? "Error desconocido"}.`);
        } finally {
            setSyncingCloud(false);
        }
    }

    const filteredClients = useMemo(() => {
        const query = normalizeClientSearch(clientSearch.trim());
        if (!query) return clients;

        return clients.filter((client) => {
            const searchable = normalizeClientSearch([
                client.nombre,
                client.apellidos,
                client.nif,
                client.email ?? "",
            ].join(" "));
            return searchable.includes(query);
        });
    }, [clients, clientSearch]);

    // Limpiar object URLs al desmontar
    useEffect(() => {
        if (editingClient) {
            if (editingClient.dniBlobFront) {
                const url = URL.createObjectURL(editingClient.dniBlobFront);
                setLocalFrontPreview(url);
            }
            if (editingClient.dniBlobBack) {
                const url = URL.createObjectURL(editingClient.dniBlobBack);
                setLocalBackPreview(url);
            }
        } else {
            if (localFrontPreview) URL.revokeObjectURL(localFrontPreview);
            if (localBackPreview) URL.revokeObjectURL(localBackPreview);
            setLocalFrontPreview(null);
            setLocalBackPreview(null);
        }

        return () => {
            if (localFrontPreview) URL.revokeObjectURL(localFrontPreview);
            if (localBackPreview) URL.revokeObjectURL(localBackPreview);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editingClient?.id, editingClient?.dniBlobFront, editingClient?.dniBlobBack]);

    useEffect(() => {
        if (clients.length > 0) return;
        if (autoCloudSyncRef.current) return;
        autoCloudSyncRef.current = true;
        void syncCloudClientsToLocal({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clients.length]);

    function handleEditClient(client: ClienteLocal) {
        setEditingClient(client);
    }

    function handleNewClient() {
        setEditingClient({
            nombre: "",
            apellidos: "",
            nif: "",
            email: "",
        });
        setLocalFrontPreview(null);
        setLocalBackPreview(null);
    }

    function handleFileChange(file: File, side: 'front' | 'back') {
        if (side === 'front') {
            setEditingClient(prev => ({ ...prev!, dniBlobFront: file }));
        } else {
            setEditingClient(prev => ({ ...prev!, dniBlobBack: file }));
        }
    }

    async function saveClient() {
        if (!editingClient?.nombre || !editingClient?.nif) {
            alert("El nombre y NIF son obligatorios.");
            return;
        }

        const payload: Omit<ClienteLocal, 'id' | 'createdAt' | 'updatedAt'> = {
            nombre: editingClient.nombre,
            apellidos: editingClient.apellidos || "",
            nif: editingClient.nif.trim().toUpperCase(),
            email: editingClient.email,
            telefono: editingClient.telefono,
            dniBlobFront: editingClient.dniBlobFront,
            dniBlobBack: editingClient.dniBlobBack,
            fuenteOrigen: 'crm',
            syncedAt: undefined
        };

        const savedId = await db.upsertCliente(payload);

        if (savedId !== undefined) {
             clientSyncService.enqueueClienteUpsert(savedId as number, 'user_action').catch(console.error);
        }

        setEditingClient(null);
    }

    async function handleDeleteClient(id: number) {
        if (confirm("¿Borrar este cliente localmente?")) {
            await db.clientes.delete(id);
            setEditingClient(null);
        }
    }

    if (editingClient) {
        return (
            <div className="flex flex-col h-full overflow-hidden bg-[#060612] text-slate-200">
                <div className="p-4 md:p-6 flex items-center justify-between border-b border-indigo-500/10 bg-[#0a0a1a] shrink-0">
                    <button onClick={() => setEditingClient(null)} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
                        <ChevronLeft className="w-5 h-5" /> Volver
                    </button>
                    <div className="flex items-center gap-3">
                        {editingClient.id && (
                            <button
                                onClick={() => handleDeleteClient(editingClient.id!)}
                                className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                            >
                                <Trash2 className="w-5 h-5" />
                            </button>
                        )}
                        <button
                            onClick={saveClient}
                            className="flex items-center gap-2 px-6 py-2 bg-indigo-500 hover:bg-indigo-600 text-white font-medium rounded-lg transition-colors"
                        >
                            <Save className="w-5 h-5" />
                            Guardar Local
                        </button>
                    </div>
                </div>

                <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
                    {/* DNI Uploads (Local Blobs) */}
                    <div className="lg:w-1/2 flex flex-col p-4 md:p-6 border-b lg:border-b-0 lg:border-r border-indigo-500/10 overflow-y-auto bg-black/20">
                        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                            <ImageIcon className="w-5 h-5 text-indigo-400" /> Documentos de Identidad (Offline)
                        </h3>

                        <div className="space-y-6">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-400">Anverso del DNI</label>
                                <div
                                    className="relative w-full aspect-[8/5] rounded-xl border-2 border-dashed border-slate-700 bg-slate-900 overflow-hidden flex items-center justify-center cursor-pointer hover:border-indigo-500 hover:bg-indigo-900/10"
                                    onClick={() => frontInputRef.current?.click()}
                                >
                                    {localFrontPreview ? (
                                        <img src={localFrontPreview} alt="DNI Anverso" className="w-full h-full object-contain" />
                                    ) : (
                                        <div className="flex flex-col items-center text-slate-500">
                                            <UploadCloud className="w-8 h-8 mb-2" />
                                            <span className="text-sm font-medium">Subir Anverso</span>
                                        </div>
                                    )}
                                    <input 
                                        type="file" accept="image/*" className="hidden" ref={frontInputRef}
                                        onChange={e => e.target.files?.[0] && handleFileChange(e.target.files[0], 'front')}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-400">Reverso del DNI</label>
                                <div
                                    className="relative w-full aspect-[8/5] rounded-xl border-2 border-dashed border-slate-700 bg-slate-900 overflow-hidden flex items-center justify-center cursor-pointer hover:border-indigo-500 hover:bg-indigo-900/10"
                                    onClick={() => backInputRef.current?.click()}
                                >
                                    {localBackPreview ? (
                                        <img src={localBackPreview} alt="DNI Reverso" className="w-full h-full object-contain" />
                                    ) : (
                                        <div className="flex flex-col items-center text-slate-500">
                                            <UploadCloud className="w-8 h-8 mb-2" />
                                            <span className="text-sm font-medium">Subir Reverso</span>
                                        </div>
                                    )}
                                    <input 
                                        type="file" accept="image/*" className="hidden" ref={backInputRef}
                                        onChange={e => e.target.files?.[0] && handleFileChange(e.target.files[0], 'back')}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="lg:w-1/2 p-4 md:p-8 overflow-y-auto">
                        <div className="max-w-md mx-auto space-y-6">
                            <div>
                                <h2 className="text-2xl font-bold text-white mb-2">Editor (Local-First)</h2>
                                <p className="text-slate-400 text-sm">Cambios se guardan en el navegador y sincronizan en background.</p>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-1">Nombre *</label>
                                    <input
                                        type="text" value={editingClient.nombre || ""}
                                        onChange={e => setEditingClient(prev => ({ ...prev!, nombre: e.target.value }))}
                                        className="w-full bg-black/20 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:border-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-1">Apellidos</label>
                                    <input
                                        type="text" value={editingClient.apellidos || ""}
                                        onChange={e => setEditingClient(prev => ({ ...prev!, apellidos: e.target.value }))}
                                        className="w-full bg-black/20 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:border-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-1">DNI/NIE *</label>
                                    <input
                                        type="text" value={editingClient.nif || ""}
                                        onChange={e => setEditingClient(prev => ({ ...prev!, nif: e.target.value }))}
                                        className="w-full bg-black/20 border border-slate-800 rounded-lg px-4 py-3 text-white focus:border-indigo-500 font-mono text-lg"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-[#060612]">
            <div className="p-6 md:p-8 flex items-center justify-between border-b border-indigo-500/10 bg-[#0a0a1a]">
                <div className="flex items-center gap-4 text-indigo-400">
                    <div className="p-3 bg-indigo-500/10 rounded-xl ring-1 ring-indigo-500/20">
                        <Users className="w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-200">Gestion de Clientes (Local)</h1>
                        <p className="text-sm text-slate-400 mt-1">Directorio offline en IndexedDB</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => void syncCloudClientsToLocal()}
                        disabled={syncingCloud}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-slate-200 font-medium rounded-lg"
                    >
                        {syncingCloud ? <Loader2 className="w-5 h-5 animate-spin" /> : <CloudDownload className="w-5 h-5" />}
                        <span>{syncingCloud ? "Sincronizando..." : "Traer de la nube"}</span>
                    </button>
                    <button
                        onClick={handleNewClient}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white font-medium rounded-lg"
                    >
                        <Plus className="w-5 h-5" />
                        <span>Nuevo Cliente</span>
                    </button>
                </div>
            </div>

            {syncMsg && (
                <div className="px-6 md:px-8 py-2 border-b border-indigo-500/10 bg-[#0a0a1a] text-sm text-slate-300">
                    {syncMsg}
                </div>
            )}

            <div className="px-6 md:px-8 py-3 border-b border-indigo-500/10 bg-[#0a0a1a]">
                 <div className="relative max-w-xl">
                    <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                        type="text"
                        value={clientSearch}
                        onChange={(e) => setClientSearch(e.target.value)}
                        placeholder="Buscar por DNI o nombre..."
                        className="w-full pl-9 pr-10 py-2 rounded-lg border border-slate-800 bg-black/20 text-slate-200 text-sm focus:border-indigo-500"
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 md:p-8">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredClients.map(client => (
                        <div
                            key={client.id}
                            onClick={() => handleEditClient(client)}
                            className="bg-[#0a0a1a] border border-slate-800/60 rounded-xl p-5 hover:border-indigo-500/50 hover:bg-[#0c0c1e] cursor-pointer transition-all"
                        >
                            <h3 className="text-lg font-semibold text-white mb-1">
                                {client.nombre} {client.apellidos}
                            </h3>
                            <p className="text-sm font-mono text-indigo-400/80 mb-3">{client.nif}</p>
                            
                            <div className="flex items-center gap-3 mt-4 text-xs text-slate-500 border-t border-slate-800/50 pt-3">
                                <span className={`flex items-center gap-1 ${!client.syncedAt ? 'text-amber-500' : 'text-emerald-500'}`}>
                                    <div className={`w-2 h-2 rounded-full ${!client.syncedAt ? 'bg-amber-500' : 'bg-emerald-500'}`}></div>
                                    {!client.syncedAt ? 'Pendiente Sync' : 'Sincronizado'}
                                </span>
                                <span className="text-slate-500">
                                    DNI {(client.dniBlobFront ? 1 : 0) + (client.dniBlobBack ? 1 : 0)}/2
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
                {filteredClients.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <Users className="w-12 h-12 text-slate-700 mb-4" />
                        <h3 className="text-lg font-semibold text-slate-400 mb-2">
                            {clientSearch ? "Sin resultados" : "Sin clientes locales"}
                        </h3>
                        <p className="text-sm text-slate-500 max-w-md">
                            {clientSearch
                                ? `No se encontraron clientes que coincidan con "${clientSearch}".`
                                : "Los clientes que guardes desde la Calculadora Térmica o con \"Nuevo Cliente\" aparecerán aquí. También puedes usar \"Traer de la nube\" para cargar el directorio cloud con sus DNIs en local."}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
