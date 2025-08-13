// index.js
const busboy = require("busboy");
const path = require("path");
const os = require("os");
const fs = require("fs");
// --- The crucial line you need to add ---
const files = require("./src/files");

// The middleware function remains the same
function Uxio(options = {}) {
  return (req, res, next) => {
    // ... (Your existing middleware logic here)
    if (
      req.method === "POST" &&
      req.headers["content-type"] &&
      req.headers["content-type"].startsWith("multipart/form-data")
    ) {
      // Create a unique ID for this request to prevent conflicts
      const requestId = Date.now().toString(36) + Math.random().toString(36).substring(2);

      // Set up a temporary cache directory for this request
      const tempCacheDir = path.join(os.tmpdir(), `.uxio-cache-${requestId}`);
      fs.mkdirSync(tempCacheDir, { recursive: true });

      // Attach the Uxio object to the request
      req.uxio = {
        get hasFile() {
          return req.uxio.files.length > 0;
        },
        hasFiles: (fieldNames) => {
          if (Array.isArray(fieldNames)) {
            return req.uxio.files.some((file) => fieldNames.includes(file.fieldname));
          } else if (typeof fieldNames === "string") {
            return req.uxio.files.some((file) => file.fieldname === fieldNames);
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

// --- The corrected export that combines both parts ---
module.exports = Object.assign(Uxio, { files });
