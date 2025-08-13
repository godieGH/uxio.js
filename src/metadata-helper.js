// src/metadata-helper.js
const { promisify } = require('util');
const { exec } = require('child_process');
const { fileTypeFromBuffer } = require('file-type');
const { imageSize } = require('image-size');
const { readFileSync } = require("node:fs");
const fs = require('fs/promises');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx'); // For Excel files
const officeparser = require('officeparser'); // For PPTX and others

// Promisify the 'exec' function for use with async/await
const execPromise = promisify(exec);

// --- 1. Define dedicated handler functions for each file type ---

const handleImage = async (filePath) => {
  const dimensions = imageSize(readFileSync(filePath));
  return {
    width: dimensions.width,
    height: dimensions.height,
    orientation: dimensions.width > dimensions.height ? 'landscape' : 'portrait',
    type: dimensions.type,
  };
};

const handleMedia = async (filePath) => {
  const ffprobeCmd = `ffprobe -v error -show_format -show_streams -of json "${filePath}"`;
  const { stdout } = await execPromise(ffprobeCmd);
  const ffprobeData = JSON.parse(stdout);

  const format = ffprobeData.format;
  const videoStream = ffprobeData.streams.find(s => s.codec_type === 'video');
  const audioStream = ffprobeData.streams.find(s => s.codec_type === 'audio');

  const metadata = {
    duration: format.duration ? parseFloat(format.duration) : null,
    container: format.format_name,
  };

  if (videoStream) {
    metadata.video = { width: videoStream.width, height: videoStream.height, codec: videoStream.codec_name };
  }
  if (audioStream) {
    metadata.audio = { codec: audioStream.codec_name, bit_rate: audioStream.bit_rate ? parseInt(audioStream.bit_rate, 10) : null };
  }
  return metadata;
};

const handlePdf = async (filePath) => {
  const dataBuffer = readFileSync(filePath);
  const pdfData = await pdfParse(dataBuffer);
  return {
    pages: pdfData.numpages,
    info: pdfData.info, // Contains author, title, creation date, etc.
  };
};

const handleExcel = async (filePath) => {
  const workbook = XLSX.readFile(filePath);
  return {
    sheets: workbook.SheetNames.length,
    sheetNames: workbook.SheetNames,
  };
};

const handlePowerPoint = async (filePath) => {
  const { slides } = await officeparser.parse(filePath);
  return {
    slidesCount: (slides && slides.length > 0) ? slides.length : null, 
  };
};

const handleWord = async (filePath) => {
  const { value: text } = await mammoth.extractRawText({ path: filePath });
  const wordCount = text.split(/\s+/).filter(word => word.length > 0).length;
  const charCount = text.length;
  return {
    wordCount,
    charCount,
  };
};

const handleText = async (filePath) => {
  const text = await fs.readFile(filePath, 'utf-8');
  const lines = text.split('\n');
  return {
    lines: lines.length,
    charCount: text.length,
    firstLine: lines[0].substring(0, 100),
  };
};

const handleBinary = async (filePath) => {
    try {
        const { stdout } = await execPromise(`file "${filePath}"`);
        const fileInfo = stdout.split(': ')[1].trim();
        return {
            platformInfo: fileInfo,
        };
    } catch (err) {
        console.warn(`'file' command failed to run. Check if it's installed and in your PATH.`);
        return { platformInfo: 'unknown' };
    }
};

// --- 2. Map MIME types to handlers ---
const handlers = {
  'image/': handleImage,
  'video/': handleMedia,
  'audio/': handleMedia,
  'application/pdf': handlePdf,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': handleExcel, // .xlsx
  'application/vnd.ms-excel': handleExcel, // .xls
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': handlePowerPoint, // .pptx
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': handleWord, // .docx
  'text/': handleText,
};

// --- 3. The main function now just orchestrates ---

const getMetadata = async (filePath, mimeType) => {
  let metadata = {
    // Initialize with a default mimeType to ensure it's always returned
    mimeType: mimeType || 'application/octet-stream',
  };
  
  try {
    if (metadata.mimeType === 'application/octet-stream') {
      const buffer = await fs.readFile(filePath);
      const type = await fileTypeFromBuffer(buffer);
      if (type) {
        metadata.mimeType = type.mime;
      }
    }
    
    // Find a handler, either by exact match or by a starting string
    const handlerKey = Object.keys(handlers).find(key => 
      metadata.mimeType === key || metadata.mimeType.startsWith(key)
    );
    
    const handler = handlers[handlerKey];
    if (handler) {
      const extractedMetadata = await handler(filePath);
      metadata = { ...metadata, ...extractedMetadata };
    } else {
      // If no specific handler, fall back to the binary handler for info
      const binaryMetadata = await handleBinary(filePath);
      metadata = { ...metadata, ...binaryMetadata };
    }
  } catch (err) {
    // This catch block is the final safety net.
    // It logs a warning but ensures the function returns a valid object.
    console.warn(`Error extracting metadata for file '${filePath}': ${err.message}`);
    // We already have a mimeType, so we just return the object as-is.
    return metadata;
  }
  
  return metadata;
};

module.exports = getMetadata;
