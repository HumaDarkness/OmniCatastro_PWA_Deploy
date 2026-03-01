import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

const accountId = import.meta.env.VITE_R2_ACCOUNT_ID;
const accessKeyId = import.meta.env.VITE_R2_ACCESS_KEY_ID;
const secretAccessKey = import.meta.env.VITE_R2_SECRET_ACCESS_KEY;
const bucketName = import.meta.env.VITE_R2_BUCKET_NAME;

export async function testR2Connection() {
    console.log("🚀 Iniciando test de conexión a Cloudflare R2...");

    if (!accountId || !accessKeyId || !secretAccessKey) {
        console.error("❌ Faltan credenciales en el archivo .env");
        return { success: false, error: "Credenciales incompletas" };
    }

    const client = new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: accessKeyId,
            secretAccessKey: secretAccessKey,
        },
    });

    try {
        const command = new ListObjectsV2Command({ Bucket: bucketName });
        await client.send(command);
        console.log("✅ ¡Conexión exitosa a R2! El bucket responde correctamente.");
        return { success: true };
    } catch (error: any) {
        console.error("❌ Error conectando a R2:", error);
        return { success: false, error: error.message };
    }
}
