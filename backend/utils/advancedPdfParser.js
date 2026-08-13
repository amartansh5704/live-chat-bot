const fs = require('fs');
const Tesseract = require('tesseract.js');
const sharp = require('sharp');

let pdfParse;
try {
  const pdfModule = require('pdf-parse');
  pdfParse = typeof pdfModule === 'function'
    ? pdfModule
    : pdfModule.default || require('pdf-parse/lib/pdf-parse.js');
} catch (err) {
  pdfParse = null;
}

const { pdf } = require('pdf-to-img');

// Sanitize text
const sanitizeText = (text) => {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\uFFFD/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

// ⭐ SMART DECISION: Should we run OCR?
// WHY: OCR is expensive. Skip it if basic parsing already gave us plenty of text.
const shouldRunOCR = (basicText, totalPages) => {
  const charsPerPage = basicText.length / Math.max(totalPages, 1);

  // If we got 500+ chars per page, basic parsing worked well
  // No need for expensive OCR
  if (charsPerPage > 500) {
    console.log(`   ✅ Basic parsing was good (${charsPerPage.toFixed(0)} chars/page). Skipping OCR.`);
    return false;
  }

  console.log(`   ⚠️  Basic parsing only got ${charsPerPage.toFixed(0)} chars/page. Running OCR...`);
  return true;
};

// OCR single image
const ocrImageBuffer = async (imageBuffer, pageNum) => {
  try {
    const processedBuffer = await sharp(imageBuffer)
      .greyscale()
      .normalize()
      .sharpen()
      .resize({ width: 1800, withoutEnlargement: false })
      .png()
      .toBuffer();

    // ⭐ Yield before heavy OCR operation
    await new Promise(resolve => setImmediate(resolve));

    const result = await Tesseract.recognize(processedBuffer, 'eng', {
      logger: () => {}
    });

    // ⭐ Yield after OCR
    await new Promise(resolve => setImmediate(resolve));

    return {
      text: sanitizeText(result.data.text),
      confidence: result.data.confidence,
      pageNum
    };
  } catch (error) {
    return { text: '', confidence: 0, pageNum };
  }
};

// Basic text extraction (fast)
const extractBasicText = async (filePath) => {
  try {
    if (!pdfParse) return { text: '', pages: 0 };
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return {
      text: sanitizeText(data.text),
      pages: data.numpages
    };
  } catch (error) {
    console.error('   ⚠️  Basic extraction failed:', error.message);
    return { text: '', pages: 0 };
  }
};

// Process pages in batches
// ⭐ Process in batches with yield to keep API responsive
const processInBatches = async (tasks, batchSize = 2) => {
  const results = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(task => task()));
    results.push(...batchResults);

    // ⭐ Yield control between batches - allows API to respond
    await new Promise(resolve => setImmediate(resolve));
  }
  return results;
};

// OCR pages (only when needed)
const extractTextFromPdfPages = async (filePath, maxPages = 30, progressCallback) => {
  try {
    const document = await pdf(filePath, { scale: 1.5 });
    const ocrTasks = [];
    let pageNum = 0;

    for await (const image of document) {
      pageNum++;
      if (pageNum > maxPages) break;

      const currentPageNum = pageNum;
      const currentImage = image;

      ocrTasks.push(async () => {
        const result = await ocrImageBuffer(currentImage, currentPageNum);
        if (progressCallback) {
          progressCallback(currentPageNum, ocrTasks.length);
        }
        return result;
      });
    }

    console.log(`   ⏳ OCR-ing ${ocrTasks.length} pages...`);
    const allResults = await processInBatches(ocrTasks, 2);

    const validResults = allResults
      .filter(r => r.text && r.text.length > 10)
      .sort((a, b) => a.pageNum - b.pageNum);

    const combinedText = validResults
      .map(p => p.text)
      .join('\n\n');

    return {
      text: combinedText,
      pageCount: validResults.length
    };
  } catch (error) {
    console.error('   ⚠️  OCR failed:', error.message);
    return { text: '', pageCount: 0 };
  }
};

// ⭐ Main parser - SMART & FAST
const parseFullPDF = async (filePath, progressCallback) => {
  try {
    console.log(`   📄 Starting PDF extraction...`);

    // Step 1: Fast basic extraction
    console.log('   1️⃣  Extracting typed text...');
    if (progressCallback) progressCallback('parsing', 20, 'Extracting text...');

    const basicResult = await extractBasicText(filePath);
    console.log(`      Got ${basicResult.text.length} chars from ${basicResult.pages} pages`);

    // Step 2: Decide if OCR is needed
    const needsOCR = shouldRunOCR(basicResult.text, basicResult.pages);

    let ocrText = '';
    let ocrPageCount = 0;

    if (needsOCR) {
      if (progressCallback) progressCallback('parsing', 40, 'Running OCR on pages...');

      const ocrResult = await extractTextFromPdfPages(
        filePath,
        30,
        (pageNum, total) => {
          if (progressCallback) {
            const pct = 40 + Math.round((pageNum / total) * 30);
            progressCallback('parsing', pct, `OCR page ${pageNum}/${total}`);
          }
        }
      );

      ocrText = ocrResult.text;
      ocrPageCount = ocrResult.pageCount;
      console.log(`      Got ${ocrText.length} chars from OCR`);
    }

    // Step 3: Use best text
    // If OCR was skipped, just use basic text (no duplication)
    // If OCR ran, use whichever has more content
    let finalText;
    if (!needsOCR) {
      finalText = basicResult.text;
    } else if (ocrText.length > basicResult.text.length * 1.5) {
      // OCR found significantly more - use it
      finalText = ocrText;
    } else {
      // Basic was better or similar - use it
      finalText = basicResult.text || ocrText;
    }

    finalText = sanitizeText(finalText);
    console.log(`   ✅ Final content: ${finalText.length} chars`);

    return {
      status: 'success',
      content: finalText,
      metadata: {
        pages: basicResult.pages,
        basicTextLength: basicResult.text.length,
        ocrTextLength: ocrText.length,
        totalLength: finalText.length,
        ocrPageCount,
        ocrSkipped: !needsOCR
      }
    };
  } catch (error) {
    console.error('   ❌ PDF parse failed:', error.message);
    return {
      status: 'failed',
      content: '',
      error: error.message
    };
  }
};

module.exports = {
  parseFullPDF,
  sanitizeText
};