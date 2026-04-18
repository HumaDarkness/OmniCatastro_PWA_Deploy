import { db } from "../../infra/db/OmniCatastroDB";
import type { QuickFillClientDTO } from "../../contracts/hoja-encargo";

const MAX_HISTORIAL_CLIENTES = 20;

/**
 * Persiste un cliente bajo política LRU pura indexada por NIF.
 * Si no trae NIF, usaremos el 'nombre' como llave única blanda (fallback).
 * Utiliza `put()` para las operaciones atómicas individuales.
 */
export async function saveQuickFillClient(
  dto: Omit<QuickFillClientDTO, "lastUsedAt" | "id">
): Promise<void> {
  await db.transaction("rw", db.quickFillClients, async () => {
    // Buscar colisión por NIF (o nombre si carece de NIF para deduplicar mínimamente)
    let existingId: number | undefined;

    if (dto.nif && dto.nif.trim() !== "") {
      const match = await db.quickFillClients.where("nif").equals(dto.nif).first();
      if (match) existingId = match.id;
    } else {
      // Checkeo ciego por nombre (Case-sensitive simple para el fallback)
      const match = await db.quickFillClients
        .filter((c) => c.nombre.toUpperCase() === dto.nombre.toUpperCase())
        .first();
      if (match) existingId = match.id;
    }

    // Insertar/Actualizar (Upsert por Id)
    await db.quickFillClients.put({
      id: existingId, // Si es undef, insertará uno nuevo auto-increment.
      nif: dto.nif,
      nombre: dto.nombre,
      domicilio: dto.domicilio,
      lastUsedAt: Date.now(), // Timetamp vital de la política de eviction (LRU)
    });

    // Aplicar LRU Eviction: Dejar estrictamente MAX_HISTORIAL_CLIENTES
    const count = await db.quickFillClients.count();
    if (count > MAX_HISTORIAL_CLIENTES) {
      const oldest = await db.quickFillClients
        .orderBy("lastUsedAt")
        .limit(count - MAX_HISTORIAL_CLIENTES)
        .toArray();

      // Eliminación masiva por clave primaria. (Ejemplo ideal donde bulkDelete es legítimo)
      const idsToDelete = oldest.map((o) => o.id as number);
      await db.quickFillClients.bulkDelete(idsToDelete);
    }
  });
}
