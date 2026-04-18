// @ts-nocheck
import { PDFDocument } from "pdf-lib";
import { kyClient } from "./kyClient";

export interface DocxConfigTecnico {
  nombre: string;
  nif: string;
  empresa: string;
  direccion: string;
  ciudad: string;
  cp: string;
}

export interface HojaEncargoPayload {
  tecnico: DocxConfigTecnico;
  propietario: {
    nombre: string;
    nif: string;
    direccion: string;
  };
  inmueble: {
    tipoVia: string;
    nombreVia: string;
    numero: string;
    bloque: string;
    escalera: string;
    planta: string;
    puerta: string;
    municipio: string;
    provincia: string;
    cp: string;
    uso: string;
  };
  lugarFirma: string;
  fechaFirma: Date;
  tipoCliente: string; // "PROPIETARIO", "REPRESENTANTE", etc.
  firmaTecnicoBlob?: Blob;
  firmaPropietarioBlob?: Blob;
  firmaPropietarioScale?: number;
  firmaTecnicoScale?: number;
}

function getMesNombre(fecha: Date): string {
  const meses = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
  ];
  return meses[fecha.getMonth()].toUpperCase();
}

/**
 * Inserta de manera inteligente una firma en base al widget destino (campo dummy o firma)
 * pdf-lib no tiene "widgets" tan accesibles como PyMuPDF, por lo que usaremos coordenadas conocidas
 * o buscaremos las coordenadas de los campos FdoTecnico y FdoPromotor.
 */
async function incrustarFirma(
  pdfDoc: PDFDocument,
  form: any,
  fieldName: string,
  firmaBlob: Blob,
  userScaleFactor: number = 1.0
) {
  try {
    const field = form.getTextField(fieldName);
    const widgets = field.acroField.getWidgets();

    if (widgets.length === 0) return;

    const widget = widgets[0];
    const rect = widget.getRectangle();

    const pageRef = widget.P();
    // Buscar a qué página pertenece el widget
    const pages = pdfDoc.getPages();
    let targetPage = pages[0]; // Fallback a la primera

    for (const page of pages) {
      if (page.ref === pageRef) {
        targetPage = page;
        break;
      }
    }

    // Cargar imagen
    const isPng = firmaBlob.type === "image/png";
    const firmBytes = new Uint8Array(await firmaBlob.arrayBuffer());
    const imageFile = isPng ? await pdfDoc.embedPng(firmBytes) : await pdfDoc.embedJpg(firmBytes);

    // Calcular Aspect Ratio (igual que PyMuPDF)
    const imgW = imageFile.width;
    const imgH = imageFile.height;
    const aspectRatio = imgW / imgH;

    const scaleFactor = 1.0 * userScaleFactor;
    const targetW = 110.0 * scaleFactor;
    const targetH = 45.0 * scaleFactor;

    let finalW, finalH;
    if (aspectRatio > targetW / targetH) {
      finalW = targetW;
      finalH = targetW / aspectRatio;
    } else {
      finalH = targetH;
      finalW = targetH * aspectRatio;
    }

    // Coordenadas (pdf-lib usa origen abajo-izquierda, a diferencia de PyMuPDF que es arriba-izquierda)
    // El rect del widget ya viene en sistema pdf-lib
    const centerX = rect.x + rect.width / 2;
    // Base line es el bottom del rect
    const baselineY = rect.y - 4;

    const x0 = centerX - finalW / 2;
    const y0 = baselineY;

    targetPage.drawImage(imageFile, {
      x: x0,
      y: y0,
      width: finalW,
      height: finalH,
    });

    // Ocultar el campo original o borrar el texto
    field.setText("");
  } catch (e) {
    console.warn(`No se pudo incrustar firma en ${fieldName}:`, e);
  }
}

export async function generarHojaEncargoPDF(payload: HojaEncargoPayload): Promise<Blob | null> {
  try {
    // 1. Obtener la plantilla (Backend Signed URL -> Fallback local)
    let templateArrayBuffer: ArrayBuffer | null = null;
    const timestamp = new Date().getTime();

    try {
      // Intentar obtener URL firmada segura desde FastAPI
      const res = await kyClient
        .get("api/v1/templates/signed-url", {
          searchParams: { template_name: "hoja_encargo.pdf" },
          timeout: 5000,
        })
        .json<{ url: string }>();

      if (res.url) {
        // Fetch directo de la URL firmada (omitiendo kyClient para no enviar JWT extra al bucket)
        const docRes = await fetch(res.url, { cache: "no-store", mode: "cors" });
        if (docRes.ok) {
          templateArrayBuffer = await docRes.arrayBuffer();
        } else {
          console.warn(`Error al descargar PDF desde presigned URL: ${docRes.status}`);
        }
      }
    } catch (e) {
      console.warn(
        "No se pudo obtener la plantilla B2B desde servidor (Fallback a estática local)",
        e
      );
    }

    if (!templateArrayBuffer) {
      const urlTemplate = `/templates/HOJA_ENCARGO_TEMPLATE.pdf?v=${timestamp}`;
      const templateResponse = await fetch(urlTemplate, { cache: "no-store" });
      if (!templateResponse.ok) {
        throw new Error(`Error al descargar la plantilla desde ${urlTemplate}`);
      }
      templateArrayBuffer = await templateResponse.arrayBuffer();
    }

    // 2. Cargar el PDF con pdf-lib
    const pdfDoc = await PDFDocument.load(templateArrayBuffer);
    const form = pdfDoc.getForm();

    // 3. Mapear TextFields
    const campos = {
      // Técnico
      NombreTecnico: payload.tecnico.nombre,
      nifTecnico: payload.tecnico.nif,
      domicilioTecnico: payload.tecnico.direccion,
      razonSocialTecnico: payload.tecnico.empresa,

      // Propietario
      nombrePromotorPropietario: payload.propietario.nombre,
      nifPromotorPropietario: payload.propietario.nif,
      direccionPFPromotorPropietario: payload.propietario.direccion,

      // Edificio
      tipoVia: payload.inmueble.tipoVia,
      nombreVia: payload.inmueble.nombreVia,
      nkm: payload.inmueble.numero,
      bloque: payload.inmueble.bloque,
      escalera: payload.inmueble.escalera,
      planta: payload.inmueble.planta,
      puerta: payload.inmueble.puerta,
      localidad: payload.inmueble.municipio,
      provincia: payload.inmueble.provincia,
      postal: payload.inmueble.cp,
      usoEdificio: payload.inmueble.uso,

      // Fecha y Lugar
      LugarFirma: payload.lugarFirma,
      diaFirma: String(payload.fechaFirma.getDate()),
      mesFirma: getMesNombre(payload.fechaFirma),
      annoFirma: String(payload.fechaFirma.getFullYear()).slice(-2),
      representante: payload.tipoCliente,
    };

    // Asignar valores
    Object.entries(campos).forEach(([key, value]) => {
      try {
        if (value) {
          const field = form.getTextField(key);
          field.setText(String(value).toUpperCase());
        }
      } catch (e) {
        console.warn(`Campo ${key} no encontrado en el PDF.`);
      }
    });

    // 4. Mapear el Checkbox: "Certificado de eficiencia energética de edificio terminado"
    // Buscar todos los checkboxes e iterar (ya que no sabemos el nombre exacto de antemano)
    const checkBoxes = form.getCheckBoxes();
    checkBoxes.forEach((cb) => {
      const name = cb.getName().toLowerCase();
      if (
        name.includes("edificio terminado") &&
        !name.includes("renovación") &&
        !name.includes("actualización")
      ) {
        cb.check();
      }
    });

    // 5. Inserción de firmas
    if (payload.firmaTecnicoBlob) {
      await incrustarFirma(
        pdfDoc,
        form,
        "FdoTecnico",
        payload.firmaTecnicoBlob,
        payload.firmaTecnicoScale || 1.0
      );
    }

    if (payload.firmaPropietarioBlob) {
      await incrustarFirma(
        pdfDoc,
        form,
        "FdoPromotor",
        payload.firmaPropietarioBlob,
        payload.firmaPropietarioScale || 1.0
      );
    }

    // 6. Remover botones (Imprimir, Limpiar Formulario)
    // pdf-lib form.flatten() suele encargarse de botones (los ignora), pero por si acaso
    try {
      const buttons = form.getButtons();
      buttons.forEach((b) => form.removeField(b));
    } catch (e) {}

    // 7. Aplanar el PDF para que ya no sea editable (Flatten)
    form.flatten();

    // Metadatos
    pdfDoc.setTitle(`Hoja de Encargo - ${payload.propietario.nombre}`);
    pdfDoc.setAuthor("OmniCatastro Suite PWA");
    pdfDoc.setSubject("Certificación Energética de Edificios");

    // 8. Guardar
    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    return blob;
  } catch (error) {
    console.error("Error al generar PDF de Hoja de Encargo:", error);
    return null;
  }
}
