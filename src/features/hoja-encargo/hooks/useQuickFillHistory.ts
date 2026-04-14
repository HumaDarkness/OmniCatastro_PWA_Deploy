import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../infra/db/OmniCatastroDB';
import type { QuickFillClientDTO } from '../../../contracts/hoja-encargo';

/**
 * Hook reactivo que provee la lista de clientes ordenados por último uso.
 * Ideal para rellenar comboboxes o dropdowns automágicos.
 */
export function useQuickFillHistory() {
    const clients = useLiveQuery(
        () => db.quickFillClients.orderBy('lastUsedAt').reverse().limit(20).toArray(),
        []
    );

    return {
        clients: clients as QuickFillClientDTO[] | undefined,
        isLoading: clients === undefined,
    };
}
