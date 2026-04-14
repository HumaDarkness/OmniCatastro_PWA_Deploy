import Dexie from 'dexie';
import type { Table } from 'dexie';
import type { QuickFillClientDTO, AssetDTO } from '../../contracts/hoja-encargo';

export class OmniCatastroDB extends Dexie {
    quickFillClients!: Table<QuickFillClientDTO, number>;
    assets!: Table<AssetDTO, number>;

    constructor() {
        super("OmniCatastroDB");

        // Versión 1: Base de DTOs para la Hoja de Encargo Offline Parity
        this.version(1).stores({
            quickFillClients: "++id, nif, lastUsedAt", // ++id = auto-increment.
            assets: "++id, alias, type, createdAt"      // e.g. "firma_tecnico"
        });
    }

    /**
     * Repositorio Opcional o métodos genéricos para DB Operations
     * Aquí podemos gestionar Wipes Totales.
     */
    async wipeAllMachineState() {
        await this.quickFillClients.clear();
        await this.assets.clear();
    }
}

export const db = new OmniCatastroDB();
