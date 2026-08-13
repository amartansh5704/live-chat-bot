const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const { parse: csvParse } = require('csv-parse/sync');
const { parseImage } = require('./imageParser');
const { parseFullPDF } = require('./advancedPdfParser');

const getFileType = (filename) => {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  const typeMap = {
    pdf: 'pdf',
    docx: 'docx', doc: 'doc',
    txt: 'txt', md: 'markdown',
    csv: 'csv', json: 'json', xml: 'xml',
    png: 'image', jpg: 'image', jpeg: 'image',
    gif: 'image', webp: 'image', bmp: 'image', tiff: 'image',
    svg: 'image',
    js: 'code', py: 'code', html: 'code', css: 'code'
  };
  return typeMap[ext] || 'other';
};

// ⭐ Accept progressCallback parameter
const parseFile = async (filePath, fileType, originalName = '', progressCallback = null) => {
  try {
    switch (fileType) {
      case 'pdf':
        return await parseFullPDF(filePath, progressCallback);
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
        return await parseImage(filePath, originalName || path.basename(filePath));
      default:
        return { status: 'unsupported', content: '[File type not supported]' };
    }
  } catch (error) {
    return { status: 'failed', content: '', error: error.message };
  }
};

const parseDOCX = async (filePath) => {
  const result = await mammoth.extractRawText({ path: filePath });
  return { status: 'success', content: result.value.trim() };
};

const parseText = async (filePath) => {
  const content = fs.readFileSync(filePath, 'utf-8');
  return { status: 'success', content: content.trim() };
};

const parseCSV = async (filePath) => {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const records = csvParse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
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

const parseJSON = async (filePath) => {
  const content = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content);
  return { status: 'success', content: JSON.stringify(data, null, 2) };
};

module.exports = { parseFile, getFileType };