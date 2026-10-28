const fs = require('fs');
const path = require('path');
const PDFDocument = require(path.resolve(__dirname, '../backend/node_modules/pdfkit'));

function exportMarkdownToPdf(mdPath, pdfPath) {
  const mdContent = fs.readFileSync(mdPath, 'utf8');
  const lines = mdContent.split(/\r?\n/);

  const doc = new PDFDocument({
    margin: 40,
    size: 'A4',
    bufferPages: true
  });

  const writeStream = fs.createWriteStream(pdfPath);
  doc.pipe(writeStream);

  const pageWidth = doc.page.width - 80;

  // Title / Header Styling
  let inCodeBlock = false;
  let codeBuffer = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        // flush code block
        doc.fillColor('#2d3748').fontSize(8).font('Courier');
        const codeText = codeBuffer.join('\n');
        doc.rect(doc.x, doc.y, pageWidth, Math.min(200, codeBuffer.length * 11 + 10))
           .fill('#f7fafc')
           .stroke('#e2e8f0');
        doc.fillColor('#1a202c').text(codeText, doc.x + 8, doc.y + 6, { width: pageWidth - 16 });
        doc.moveDown(0.8);
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBuffer = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Horizontal Rule
    if (line.match(/^---+$/)) {
      doc.moveDown(0.5);
      doc.strokeColor('#cbd5e0').lineWidth(1).moveTo(doc.x, doc.y).lineTo(doc.x + pageWidth, doc.y).stroke();
      doc.moveDown(0.5);
      continue;
    }

    // Headings
    if (line.startsWith('# ')) {
      doc.addPage();
      doc.fillColor('#1a365d').fontSize(20).font('Helvetica-Bold').text(line.replace(/^#\s+/, ''), { width: pageWidth });
      doc.moveDown(0.5);
      continue;
    }

    if (line.startsWith('## ')) {
      if (doc.y > doc.page.height - 120) doc.addPage();
      else doc.moveDown(0.8);
      doc.fillColor('#2b6cb0').fontSize(14).font('Helvetica-Bold').text(line.replace(/^##\s+/, ''), { width: pageWidth });
      doc.moveDown(0.4);
      continue;
    }

    if (line.startsWith('### ')) {
      if (doc.y > doc.page.height - 100) doc.addPage();
      else doc.moveDown(0.6);
      doc.fillColor('#2d3748').fontSize(11).font('Helvetica-Bold').text(line.replace(/^###\s+/, ''), { width: pageWidth });
      doc.moveDown(0.3);
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const quoteText = line.replace(/^>\s+/, '').replace(/\*\*/g, '');
      doc.rect(doc.x, doc.y, 4, 20).fill('#3182ce');
      doc.fillColor('#4a5568').fontSize(9.5).font('Helvetica-Oblique').text(quoteText, doc.x + 12, doc.y, { width: pageWidth - 20 });
      doc.moveDown(0.4);
      continue;
    }

    // Tables
    if (line.startsWith('|')) {
      // Simple table line rendering
      if (line.includes('---')) continue; // skip separator row
      const cells = line.split('|').map(c => c.trim()).filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
      if (cells.length > 0) {
        const colWidth = pageWidth / cells.length;
        const startY = doc.y;
        if (startY > doc.page.height - 60) doc.addPage();
        
        const isHeader = (i + 1 < lines.length && lines[i + 1].includes('---'));
        doc.fontSize(8.5).font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fillColor(isHeader ? '#1a202c' : '#4a5568');
        
        let maxHeight = 16;
        cells.forEach((cell, cellIdx) => {
          const cleanCell = cell.replace(/\*\*/g, '').replace(/&rarr;/g, '->').replace(/&times;/g, 'x');
          doc.text(cleanCell, 40 + (cellIdx * colWidth), startY, {
            width: colWidth - 6,
            align: 'left'
          });
        });
        doc.y = startY + maxHeight;
      }
      continue;
    }

    // Bullet points
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const bulletText = line.replace(/^[-*]\s+/, '').replace(/\*\*/g, '');
      doc.fillColor('#2d3748').fontSize(9).font('Helvetica').text(`•  ${bulletText}`, {
        indent: 10,
        width: pageWidth - 10
      });
      doc.moveDown(0.2);
      continue;
    }

    // Numbered list
    if (line.match(/^\d+\.\s+/)) {
      const listText = line.replace(/\*\*/g, '');
      doc.fillColor('#2d3748').fontSize(9).font('Helvetica').text(listText, {
        indent: 10,
        width: pageWidth - 10
      });
      doc.moveDown(0.2);
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      doc.moveDown(0.3);
      continue;
    }

    // Normal paragraph
    const cleanParagraph = line.replace(/\*\*/g, '').replace(/&rarr;/g, '->').replace(/&times;/g, 'x');
    doc.fillColor('#2d3748').fontSize(9.5).font('Helvetica').text(cleanParagraph, { width: pageWidth });
    doc.moveDown(0.3);
  }

  // Footer / Page numbers
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).font('Helvetica').fillColor('#a0aec0').text(
      `TalentOS Production Performance & Zero-Cost Optimisation Report | Page ${i + 1} of ${pages.count}`,
      40,
      doc.page.height - 30,
      { align: 'center', width: pageWidth }
    );
  }

  doc.end();

  return new Promise((resolve, reject) => {
    writeStream.on('finish', () => resolve());
    writeStream.on('error', (err) => reject(err));
  });
}

const inputMd = path.resolve(__dirname, 'reports/perf/FINAL-PERFORMANCE-REPORT.md');
const outputPdf = path.resolve(__dirname, 'reports/perf/FINAL-PERFORMANCE-REPORT.pdf');

console.log(`Generating PDF from ${inputMd} -> ${outputPdf}...`);
exportMarkdownToPdf(inputMd, outputPdf)
  .then(() => {
    const stats = fs.statSync(outputPdf);
    console.log(`Successfully generated ${outputPdf} (${stats.size} bytes)`);
  })
  .catch(err => {
    console.error(`Failed to generate PDF:`, err);
    process.exit(1);
  });
