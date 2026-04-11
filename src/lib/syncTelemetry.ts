import { getCurrentOrganizationId, supabase } from "./supabase";

export type SyncTelemetryEvent =
    | "conflict_detected"
    | "conflict_user_choice"
    | "conflict_user_local_wins"
    | "conflict_user_remote_wins"
    | "write_discarded_identical"
    | "sync_success"
    | "sync_error"
    | "sync_queue_flushed";

export type SyncTelemetryMeta = Record<string, unknown>;

interface BufferedSyncEvent {
    event: SyncTelemetryEvent;
    meta: SyncTelemetryMeta;
    occurredAt: string;
}

const MAX_BUFFER_SIZE = 100;
let bufferedEvents: BufferedSyncEvent[] = [];
let isFlushing = false;

function hasSupabaseClient(): boolean {
    const client = supabase as unknown as { from?: unknown; auth?: unknown } | null;
    if (!client) return false;
    if (typeof client.from !== "function") return false;
    if (!client.auth || typeof (client.auth as { getSession?: unknown }).getSession !== "function") return false;
    return true;
}

function pushToBuffer(entry: BufferedSyncEvent): void {
    bufferedEvents.push(entry);
    if (bufferedEvents.length > MAX_BUFFER_SIZE) {
        bufferedEvents = bufferedEvents.slice(bufferedEvents.length - MAX_BUFFER_SIZE);
    }
}

async function resolveUserId(): Promise<string | null> {
    if (!hasSupabaseClient()) return null;

    try {
        const { data, error } = await supabase.auth.getSession();
        if (error) return null;
        return data.session?.user?.id ?? null;
    } catch {
        return null;
    }
}

async function resolveTelemetryContext(): Promise<{ userId: string; organizationId: string } | null> {
    const userId = await resolveUserId();
    if (!userId) return null;

    const organizationId = await getCurrentOrganizationId();
    if (!organizationId) return null;

    return { userId, organizationId };
}

async function flushBuffer(): Promise<void> {
    if (isFlushing) return;
    if (!hasSupabaseClient()) return;
    if (bufferedEvents.length === 0) return;

    const context = await resolveTelemetryContext();
    if (!context) return;

    isFlushing = true;

    try {
        while (bufferedEvents.length > 0) {
            const chunk = bufferedEvents.slice(0, 20);
            const rows = chunk.map((entry) => ({
                organization_id: context.organizationId,
                user_id: context.userId,
                event: entry.event,
                meta: entry.meta,
                occurred_at: entry.occurredAt,
            }));

            const { error } = await supabase.from("sync_events").insert(rows);
            if (error) {
                break;
            }

            bufferedEvents = bufferedEvents.slice(chunk.length);
        }
    } catch {
        // Telemetry must never break sync flows.
    } finally {
        isFlushing = false;
    }
}

export function trackSyncEvent(event: SyncTelemetryEvent, meta: SyncTelemetryMeta = {}): void {
    pushToBuffer({
        event,
        meta,
        occurredAt: new Date().toISOString(),
    });

    void flushBuffer();
}

export function __getBufferedEventsForTest(): BufferedSyncEvent[] {
    return [...bufferedEvents];
}

export function __resetSyncTelemetryForTest(): void {
    bufferedEvents = [];
    isFlushing = false;
}
