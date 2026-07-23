import PDFDocument from "pdfkit";

export function generateSimplePdf(record) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.fontSize(16).text("Fragestunde — Frage", { underline: true });
    doc.moveDown();
    doc.fontSize(11).text(`Session: ${record.payload.session}`);
    doc.text(`Eingereicht am: ${record.payload.eingereicht_am}`);
    doc.text(`Parlamentarier-DID: ${record.payload.parlamentarier_did}`);
    doc.moveDown();
    doc.fontSize(12).text(record.payload.fragetext, { align: "left" });
    doc.moveDown(2);
    doc.fontSize(9).fillColor("gray")
      .text(`RecordWeb PoC — DID: ${record.did}`);

    doc.end();
  });
}