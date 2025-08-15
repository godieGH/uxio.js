// src/uxio.js

const busboy = require("busboy");
const path = require("path");
const os = require("os");
const fs = require("fs");
const files = require("./files");

/**
 * Uxio captures file(s) for a specific route, creates file object(s), places them in the req.uxio.files array
 * 
 * @typedef {object} UxioFile 
 * @property {string} fieldname - The name of the form field.
 * @property {string} filename - The original name of the file.
 * @property {string} encoding - The encoding of the file.
 * @property {string} mimeType - The MIME type of the file.
 * @property {string} tempFilePath - The full path to the temporary file on the disk.
 * @property {number} size - The size of the file in bytes.
 */

/**
 * This is the uxio file object passed in the req.uxio, It give yiu control of the uploaded file in the tempCache.
 * 
 * @typedef {object} UxioObject
 * @property {function(): boolean} hasFile - Checks if any file was uploaded in the request.
 *
 * @property {function} hasFiles - Checks if files with specific field names exist.
 * @param {string|string[]} fieldNames - The name(s) of the file field(s) to check for.
 * @returns {boolean} True if any of the specified file fields exist, otherwise false.
 *
 * @property {UxioFile[]} files - An array of objects, each representing an uploaded file.
 * @property {function(): void} cleanup - Manually cleans up the temporary cache directory.
 */

/**
 * Express/Connect-compatible middleware for handling multipart/form-data uploads.
 * This middleware parses uploaded files and form fields, making them available on
 * `req.uxio` and `req.body` objects.
 *
 * It automatically cleans up temporary files once the response is finished or closed.
 *
 * @param {Object} [options] - Optional configuration for the middleware.
 * @returns {Function} Express/Connect-compatible middleware function.
 */
function Uxio(options = {}) {
  return (req, res, next) => {
    if (
      req.method === "POST" &&
      req.headers["content-type"] &&
      req.headers["content-type"].startsWith("multipart/form-data")
    ) {
      const requestId = Date.now().toString(36) + Math.random().toString(36).substring(2);

      const tempCacheDir = path.join(os.tmpdir(), `.uxio-cache-${requestId}`);
      fs.mkdirSync(tempCacheDir, { recursive: true });

      req.uxio = {
        get hasFile() {
          return this.files.length > 0;
        },
        hasFiles: (fieldNames) => {
          if (Array.isArray(fieldNames)) {
            return this.files.some((file) => fieldNames.includes(file.fieldname));
          } else if (typeof fieldNames === "string") {
            return this.files.some((file) => file.fieldname === fieldNames);
          }
          return false;
        },
        files: [],
        cleanup: () => {
          if (fs.existsSync(tempCacheDir)) {
            fs.rmSync(tempCacheDir, { recursive: true, force: true });
            console.log(`Cleaned up temp directory: ${tempCacheDir}`);
          }
        },
      };

      res.on("finish", () => {
        req.uxio.cleanup();
      });
      res.on("close", () => {
        req.uxio.cleanup();
      });

      const bb = busboy({ headers: req.headers });

      bb.on("file", (fieldname, file, info) => {
        const { filename, encoding, mimeType } = info;
        const tempFilePath = path.join(
          tempCacheDir,
          `${fieldname}-${filename}`,
        );
        const writeStream = fs.createWriteStream(tempFilePath);
        req.uxio.files.push({
          fieldname,
          filename,
          encoding,
          mimeType,
          tempFilePath,
          size: 0,
        });

        file.on("data", (data) => {
          const fileObj = req.uxio.files.find((f) => f.fieldname === fieldname);
          if (fileObj) {
            fileObj.size += data.length;
          }
        });
        file.pipe(writeStream);
      });

      bb.on("field", (fieldname, val, info) => {
        req.body = req.body || {};
        req.body[fieldname] = val;
      });

      bb.on("close", () => {
        next();
      });

      req.pipe(bb);
    } else {
      next();
    }
  };
};

module.exports = Object.assign(Uxio, { files });
