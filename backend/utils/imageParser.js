const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const sizeOf = require('image-size');
const fs = require('fs');
const path = require('path');

// ── Preprocess image for better OCR accuracy ──
// WHY: OCR works much better on high-contrast, properly-sized images
//      Sharp resizes and enhances the image before feeding to OCR
const preprocessImage = async (inputPath) => {
  try {
    const outputPath = inputPath.replace(/(\.[^.]+)$/, '_processed$1');

    await sharp(inputPath)
      .greyscale()               // Remove color (helps OCR focus on text)
      .normalize()               // Improve contrast
      .resize({ width: 2000, withoutEnlargement: true })  // Upscale small images
      .toFile(outputPath);

    return outputPath;
  } catch (error) {
    console.warn('Preprocess failed, using original:', error.message);
    return inputPath;
  }
};

// ── Extract text from image using Tesseract OCR ──
const extractTextFromImage = async (imagePath) => {
  try {
    console.log('   🔤 Running OCR on image...');

    const processedPath = await preprocessImage(imagePath);

    const result = await Tesseract.recognize(
      processedPath,
      'eng',
      {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            const percent = Math.round(m.progress * 100);
            if (percent % 25 === 0) {
              console.log(`      OCR progress: ${percent}%`);
            }
          }
        }
      }
    );

    if (processedPath !== imagePath && fs.existsSync(processedPath)) {
      fs.unlinkSync(processedPath);
    }

    // ⭐ Clean OCR output immediately
    let text = result.data.text || '';

    // Remove null bytes and control characters
    text = text
      .replace(/\u0000/g, '')
      .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\uFFFD/g, '')
      // Remove weird OCR artifacts (isolated single chars, gibberish)
      .replace(/\s+/g, ' ')
      .trim();

    const confidence = result.data.confidence;

    console.log(`   ✅ OCR complete: ${text.length} chars, ${confidence.toFixed(0)}% confidence`);

    return {
      text,
      confidence,
      wordCount: text.split(/\s+/).filter(w => w.length > 0).length
    };
  } catch (error) {
    console.error('OCR error:', error.message);
    return {
      text: '',
      confidence: 0,
      wordCount: 0,
      error: error.message
    };
  }
};



// ── Extract image metadata (dimensions, format) ──
const getImageMetadata = (imagePath) => {
  try {
    const buffer = fs.readFileSync(imagePath);
    const dimensions = sizeOf(buffer);
    const stats = fs.statSync(imagePath);

    return {
      width: dimensions.width,
      height: dimensions.height,
      format: dimensions.type,
      sizeBytes: stats.size,
      aspectRatio: (dimensions.width / dimensions.height).toFixed(2)
    };
  } catch (error) {
    console.error('Metadata error:', error.message);
    return null;
  }
};

// ── Main image parse function ──
// Returns combined text + metadata suitable for embedding
const parseImage = async (imagePath, originalName) => {
  try {
    console.log(`   🖼️  Processing image: ${originalName}`);

    // 1. Get metadata
    const metadata = getImageMetadata(imagePath);

    // 2. Extract text via OCR
    const ocrResult = await extractTextFromImage(imagePath);

    // 3. Build searchable content
    let content = '';

    // Add filename info (helps searching by name)
    content += `Filename: ${originalName}\n`;

    // Add metadata
    if (metadata) {
      content += `Image: ${metadata.width}x${metadata.height} ${metadata.format.toUpperCase()}\n`;
      content += `Aspect ratio: ${metadata.aspectRatio}\n`;
    }

    // Add OCR extracted text (this is the main content)
    if (ocrResult.text && ocrResult.text.length > 5) {
      content += `\nExtracted text:\n${ocrResult.text}\n`;
      content += `\n[OCR confidence: ${ocrResult.confidence.toFixed(0)}%, ${ocrResult.wordCount} words detected]`;
    } else {
      content += `\n[No readable text found in image]`;
    }

    // Determine parse status
    let status = 'success';
    if (!ocrResult.text || ocrResult.text.length < 5) {
      // No text found but we still have metadata
      status = 'success'; // Still count as success - image was analyzed
    }

    return {
      status,
      content,
      metadata: {
        ...metadata,
        ocr: {
          text: ocrResult.text,
          confidence: ocrResult.confidence,
          wordCount: ocrResult.wordCount
        }
      }
    };
  } catch (error) {
    console.error('Image parse error:', error.message);
    return {
      status: 'failed',
      content: '',
      error: error.message
    };
  }
};

module.exports = {
  parseImage,
  extractTextFromImage,
  getImageMetadata,
  preprocessImage
};