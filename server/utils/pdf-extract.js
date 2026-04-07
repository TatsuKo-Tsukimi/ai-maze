'use strict';
// Helper script: extract text from PDF using pdf-parse v2
// Usage: node pdf-extract.js <filepath>

const fs = require('fs');
const { PDFParse } = require('pdf-parse');

const filePath = process.argv[2];
if (!filePath) {
  process.exit(1);
}

const parser = new PDFParse();
parser.parseBuffer(fs.readFileSync(filePath))
  .then(result => {
    process.stdout.write((result.text || '').slice(0, 4000));
  })
  .catch(() => process.exit(1));
