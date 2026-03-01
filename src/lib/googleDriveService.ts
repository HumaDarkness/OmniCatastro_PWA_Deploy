/**
 * Servicio para interactuar con la API de Google Drive v3
 */

const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_API_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

export interface DriveFolder {
    id: string;
    name: string;
}

/**
 * Busca una carpeta por nombre y (opcionalmente) padre.
 * Si no existe, la crea.
 */
export async function getOrCreateFolder(
    accessToken: string,
    folderName: string,
    parentId?: string
): Promise<string> {
    // 1. Buscar si ya existe
    let query = `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    if (parentId) {
        query += ` and '${parentId}' in parents`;
    }

    const response = await fetch(`${DRIVE_API_URL}?q=${encodeURIComponent(query)}&fields=files(id, name)`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    const data = await response.json();

    if (data.files && data.files.length > 0) {
        return data.files[0].id;
    }

    // 2. Crear si no existe
    const createResponse = await fetch(DRIVE_API_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: parentId ? [parentId] : [],
        }),
    });

    const folder = await createResponse.json();
    return folder.id;
}

/**
 * Sube un archivo (Blob) a una carpeta específica de Google Drive.
 */
export async function uploadFileToDrive(
    accessToken: string,
    fileBlob: Blob,
    fileName: string,
    folderId: string
): Promise<string> {
    const metadata = {
        name: fileName,
        parents: [folderId],
    };

    const formData = new FormData();
    formData.append(
        'metadata',
        new Blob([JSON.stringify(metadata)], { type: 'application/json' })
    );
    formData.append('file', fileBlob);

    const response = await fetch(UPLOAD_API_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
        body: formData,
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Error subiendo a Google Drive: ${error.error?.message || 'Unknown error'}`);
    }

    const result = await response.json();
    return result.id;
}
