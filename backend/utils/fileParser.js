const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { parse: csvParse } = require('csv-parse/sync');

// Detect file type from extension
const getFileType = (filename) => {
  const ext = path.extname(filename).toLowerCase().replace('.', '');

  const typeMap = {
    // Documents
    pdf: 'pdf',
    docx: 'docx',
    doc: 'doc',
    txt: 'txt',
    md: 'markdown',

    // Data
    csv: 'csv',
    json: 'json',
    xml: 'xml',

    // Images
    png: 'image',
    jpg: 'image',
    jpeg: 'image',
    gif: 'image',
    webp: 'image',
    svg: 'image',

    // Code
    js: 'code',
    py: 'code',
    html: 'code',
    css: 'code'
  };

  return typeMap[ext] || 'other';
};

// Main parse function - routes to the right parser based on type
const parseFile = async (filePath, fileType) => {
  try {
    switch (fileType) {
      case 'pdf':
        return await parsePDF(filePath);

      case 'docx':
        return await parseDOCX(filePath);

      case 'txt':
      case 'markdown':
      case 'code':
        return await parseText(filePath);

      case 'csv':
        return await parseCSV(filePath);

      case 'json':
        return await parseJSON(filePath);

      case 'image':
        return {
          status: 'unsupported',
          content: '[Image file - preview not supported yet]'
        };

      default:
        return {
          status: 'unsupported',
          content: '[File type not supported for parsing]'
        };
    }
  } catch (error) {
    console.error(`Parse error for ${filePath}:`, error.message);
    return {
      status: 'failed',
      content: '',
      error: error.message
    };
  }
};

// ── PDF Parser ──
const parsePDF = async (filePath) => {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return {
    status: 'success',
    content: data.text.trim(),
    metadata: {
      pages: data.numpages,
      info: data.info
    }
  };
};

// ── DOCX Parser ──
const parseDOCX = async (filePath) => {
  const result = await mammoth.extractRawText({ path: filePath });
  return {
    status: 'success',
    content: result.value.trim()
  };
};

// ── Plain Text Parser ──
const parseText = async (filePath) => {
  const content = fs.readFileSync(filePath, 'utf-8');
  return {
    status: 'success',
    content: content.trim()
  };
};

// ── CSV Parser ──
const parseCSV = async (filePath) => {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const records = csvParse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  // Convert to readable text preview
  const preview = records.slice(0, 20)
    .map((row, i) => `Row ${i + 1}: ${JSON.stringify(row)}`)
    .join('\n');

  return {
    status: 'success',
    content: `CSV file with ${records.length} rows\n\nPreview:\n${preview}`,
    metadata: {
      rowCount: records.length,
      columns: records.length > 0 ? Object.keys(records[0]) : []
    }
  };
};

// ── JSON Parser ──
const parseJSON = async (filePath) => {
  const content = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content);
  return {
    status: 'success',
    content: JSON.stringify(data, null, 2)
  };
};

module.exports = {
  parseFile,
  getFileType
};