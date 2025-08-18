// src/files.js
const path = require("path");
const fs = require("fs");
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const axios = require("axios");

const getMetadata = require('./metadata-helper.js')

/**
 * @module files
 */
 
 /**
  * @typedef {object} validations
  * @property {number} [maxSize] Maximum file size in bytes.
  * @property {string[]} [mimeType] Allowed MIME types.
 */

/**
 * Custom error class for file-related operations.
 * Allows throwing errors with a specific status code for better API handling.
 */
class FileSaveError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "FileSaveError";
    this.status = status;
  }
}

/**
 * @lends module:files
*/
const files = {
  /**
   * Saves one or more files based on the provided configuration.
   * The configuration can be a single object or an array of objects for granular control.
   * On failure, any files that were already saved successfully are deleted (rolled back).
   *
   * @param {object|object[]} config The save configuration.
   * @param {string|string[]} config.fieldname The field name(s) of the file(s) to save.
   * @param {string|string[]} config.filename (DEPRECATED) use fieldname instead.
   * @param {string} config.path The destination directory to save the files.
   * @param {boolean} [config.required=false] If true, an error is thrown if no files match the filename(s).
   * @param {boolean} [config.makedir=false] If true, the destination directory will be created recursively if not found.
   * @param {validations} [config.validations] Optional validation rules. see <a href="#~validations">validations</a>
   * @param {function} [config.rename] A function to rename the file.
   * @param {object} uxioObject The `req.uxio` object containing cached file data.
   * @returns {Promise<object[]>} An array of file info objects.
   */
  save: async (config, uxioObject) => {
    // Standardize config into an array to simplify processing
    const configsToProcess = Array.isArray(config) ? config : [config];
    const savedFilesInfo = [];
    const savedFilePathsForRollback = [];

    try {
      for (const currentConfig of configsToProcess) {
        const {
          fieldname,
          filename,
          path: destinationPath,
          validations,
          rename,
          required = false,
          makedir = false, 
        } = currentConfig;

        const fieldnamesToSave = fieldname
    ? (Array.isArray(fieldname) ? fieldname : [fieldname])
    : (Array.isArray(filename) ? filename : [filename]);
    
    if (!fieldname && filename) {
    console.warn("Deprecation Warning: 'filename' is deprecated. Please use 'fieldname' instead.");
}
    
        const filesToSave = uxioObject.files.filter((f) =>
          fieldnamesToSave.includes(f.fieldname),
        );

        if (required && filesToSave.length === 0) {
          throw new FileSaveError(
            `Required files not found for fields: ${fieldnamesToSave.join(", ")}.`,
            404,
          );
        }

        if (filesToSave.length === 0) {
          continue;
        }

        try {
          await fs.promises.access(destinationPath);
        } catch (err) {
          if (err.code === 'ENOENT') {
            if (makedir) {
              await fs.promises.mkdir(destinationPath, { recursive: true });
            } else {
              throw new FileSaveError(`Destination directory not found: ${destinationPath}`, 404);
            }
          } else {
            throw err;
          }
        }

        for (const fileToSave of filesToSave) {
          if (validations) {
            if (validations.maxSize && fileToSave.size > validations.maxSize) {
              throw new FileSaveError(
                `File size for '${fileToSave.filename}' exceeds limit of ${validations.maxSize} bytes.`,
              );
            }
            if (validations.mimeType) {
              const allowedMimeTypes = Array.isArray(validations.mimeType)
                ? validations.mimeType
                : validations.mimeType.split(",").map((m) => m.trim());
              if (!allowedMimeTypes.includes(fileToSave.mimeType)) {
                throw new FileSaveError(`Invalid file type for '${fileToSave.filename}'. Only ${allowedMimeTypes.join(", ")} are allowed.`,);
              }
            }
          }
          
          const metadata = await getMetadata(fileToSave.tempFilePath, fileToSave.mimeType)

          const newFilename = typeof rename === "function" ? rename(fileToSave) : fileToSave.filename;
          const finalFilePath = path.join(destinationPath, newFilename);

          try {
            await fs.promises.access(finalFilePath, fs.constants.F_OK);
            throw new FileSaveError(`File with name '${newFilename}' already exists.`, 409);
          } catch (e) {
            if (e.code !== 'ENOENT' && e.status !== 409) {
                throw e;
            } else if (e.status === 409) {
                throw e;
            }
          }

          await fs.promises.rename(fileToSave.tempFilePath, finalFilePath);
          savedFilePathsForRollback.push(finalFilePath);

          const fileInfo = {
            fieldname: fileToSave.fieldname,
            originalName: fileToSave.filename,
            path: finalFilePath,
            size: fileToSave.size,
            mimeType: fileToSave.mimeType,
            ...metadata,
          };
          savedFilesInfo.push(fileInfo);
        }
      }
    } catch (err) {
      console.error("File save operation failed. Initiating rollback...", err);
      const cleanupPromises = savedFilePathsForRollback.map((filePath) =>
        fs.promises.unlink(filePath).catch((cleanupErr) => {
          console.error(`Failed to delete saved file during rollback: ${filePath}`, cleanupErr);
        }),
      );
      await Promise.allSettled(cleanupPromises);
      console.log("Rollback completed.");

      if (err instanceof FileSaveError) {
        throw err;
      }
      throw new FileSaveError(err.message, err.status);
    }

    return savedFilesInfo;
  },
  
  
  
  
  /**
   * Sends one or more files to an external service (e.g., S3, custom server).
   * On failure, any files that were already sent are deleted from the external service (rolled back).
   *
   * @param {object|object[]} config The send configuration.
   * @param {string|string[]} config.fieldname The field name(s) of the file(s) to send.
   * @param {string|string[]} [config.filename] (DEPRECATED) Use 'fieldname' instead.
   * @param {string} config.provider The destination service provider (e.g., 's3', 'customHttp').
   * @param {object} config.options Provider-specific options.
   * @param {boolean} [config.required=false] If true, throws an error if no files match the filename(s).
   * @param {validations} [config.validations] Optional validation rules. see <a href="#~validations">validations</a>
   * @param {function} [config.rename] A function to rename the file before sending.
   * @param {object} uxioObject The `req.uxio` object containing cached file data.
   * @returns {Promise<object[]>} An array of file info objects from the provider.
   */
  send: async (config, uxioObject) => {
    const configsToProcess = Array.isArray(config) ? config : [config];
    const sentFilesInfo = [];
    const uploadedObjectsForRollback = [];

    try {
      for (const currentConfig of configsToProcess) {
        const {
          filename,
          fieldname,
          provider,
          options,
          validations,
          rename,
          required = false,
        } = currentConfig;

        if (!provider) {
          throw new FileSaveError("A 'provider' must be specified in the configuration.", 400);
        }

        const fieldnamesToSend = fieldname
    ? (Array.isArray(fieldname) ? fieldname : [fieldname])
    : (Array.isArray(filename) ? filename : [filename]);
    
   if (!fieldname && filename) {
    console.warn("Deprecation Warning: 'filename' is deprecated. Please use 'fieldname' instead.");
} 
        const filesToSend = uxioObject.files.filter((f) =>
          fieldnamesToSend.includes(f.fieldname),
        );

        if (required && filesToSend.length === 0) {
          throw new FileSaveError(
            `Required files not found for fields: ${fieldnamesToSend.join(", ")}.`,
            404,
          );
        }

        if (filesToSend.length === 0) {
          continue;
        }

        for (const fileToSend of filesToSend) {
          if (validations) {
            if (validations.maxSize && fileToSend.size > validations.maxSize) {
              throw new FileSaveError(
                `File size for '${fileToSend.filename}' exceeds limit of ${validations.maxSize} bytes.`,
              );
            }
            if (validations.mimeType) {
              const allowedMimeTypes = Array.isArray(validations.mimeType)
                ? validations.mimeType
                : validations.mimeType.split(",").map((m) => m.trim());
              if (!allowedMimeTypes.includes(fileToSend.mimeType)) {
                throw new FileSaveError(
                  `Invalid file type for '${fileToSend.filename}'. Only ${allowedMimeTypes.join(", ")} are allowed.`
                );
              }
            }
          }
          
          const metadata = await getMetadata(fileToSend.tempFilePath, fileToSend.mimeType)
          

          const newFilename = typeof rename === "function" ? rename(fileToSend) : fileToSend.filename;
          const fileStream = fs.createReadStream(fileToSend.tempFilePath);
          let uploadResult;

          switch (provider.toLowerCase()) {
            case "s3": {
              if (!options || !options.bucket || !options.region || !options.credentials) {
                throw new FileSaveError("S3 provider requires 'bucket', 'region', and 'credentials' in options.", 400);
              }
              const s3Client = new S3Client({
                region: options.region,
                credentials: options.credentials,
              });
              const command = new PutObjectCommand({
                Bucket: options.bucket,
                Key: newFilename,
                Body: fileStream,
                ContentType: fileToSend.mimeType,
                ContentLength: fileToSend.size,
              });

              await s3Client.send(command);
              
              uploadResult = {
                provider: 's3',
                bucket: options.bucket,
                key: newFilename,
                url: `https://${options.bucket}.s3.${options.region}.amazonaws.com/${encodeURIComponent(newFilename)}`,
                size: fileToSend.size,
                mimeType: fileToSend.mimeType,
                ...metadata,
              };
              uploadedObjectsForRollback.push({ provider: 's3', ...uploadResult });
              break;
            }

            case "customhttp": {
              if (!options || !options.url) {
                throw new FileSaveError("customHttp provider requires a 'url' in options.", 400);
              }

              const response = await axios.post(options.url, fileStream, {
                headers: {
                  'Content-Type': fileToSend.mimeType,
                  'Content-Length': fileToSend.size,
                  'X-Original-Filename': encodeURIComponent(fileToSend.filename),
                },
                ...options.axiosConfig, 
              });

              uploadResult = {
                  provider: 'customHttp',
                  ...response.data, 
                  ...metadata,
              };
              /**
               * 
               * Note: Rollback for customHttp is complex and not implemented here.
               * The destination server would need to provide a DELETE endpoint.
               */
              break;
            }

            default:
              throw new FileSaveError(`Unsupported provider: '${provider}'.`, 400);
          }

          sentFilesInfo.push(uploadResult);
        }
      }
    } catch (err) {
      console.error("File send operation failed. Initiating rollback...", err);
      
      const cleanupPromises = uploadedObjectsForRollback.map(async (item) => {
        try {
          if (item.provider === 's3') {
            console.log(`Rolling back S3 object: ${item.key} from bucket ${item.bucket}`);
            const s3Client = new S3Client({
              region: item.url.split('.')[2], // Infer region from URL
              credentials: config.find(c => c.provider === 's3')?.options.credentials,
            });
            const command = new DeleteObjectCommand({
              Bucket: item.bucket,
              Key: item.key,
            });
            await s3Client.send(command);
          }
        } catch (cleanupErr) {
           console.error(`Failed to delete sent file during rollback: ${item.key || item.url}`, cleanupErr);
        }
      });
      await Promise.allSettled(cleanupPromises);
      console.log("Rollback completed.");

      if (err instanceof FileSaveError) {
        throw err;
      }
      throw new FileSaveError(err.message, err.status || 500);
    }

    return sentFilesInfo;
  },
  
  
  
  
};

module.exports = files;
