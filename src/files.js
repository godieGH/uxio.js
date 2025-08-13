// src/files.js
const path = require("path");
const fs = require("fs");

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

const files = {
  /**
   * Saves one or more files based on the provided configuration.
   * The configuration can be a single object or an array of objects for granular control.
   * On failure, any files that were already saved successfully are deleted (rolled back).
   *
   * @param {object|object[]} config The save configuration.
   * @param {string|string[]} config.filename The field name(s) of the file(s) to save.
   * @param {string} config.path The destination directory to save the files.
   * @param {boolean} [config.required=false] If true, an error is thrown if no files match the filename(s).
   * @param {boolean} [config.makedir=false] If true, the destination directory will be created recursively if not found.
   * @param {object} [config.validations] Optional validation rules.
   * @param {number} [config.validations.maxSize] Maximum file size in bytes.
   * @param {string|string[]} [config.validations.mimeType] Allowed MIME types.
   * @param {function} [config.rename] A function to rename the file.
   * @param {object} uxioObject The `req.uxio` object containing cached file data.
   * @returns {Promise<object[]>} An array of file info objects.
   */
  save: async (config, uxioObject) => {
    // Standardize config into an array to simplify processing
    const configsToProcess = Array.isArray(config) ? config : [config];
    const savedFilesInfo = [];
    const savedFilePathsForRollback = [];

    // --- MAIN PROCESSING LOOP ---
    try {
      for (const currentConfig of configsToProcess) {
        const {
          filename,
          path: destinationPath,
          validations,
          rename,
          required = false,
          makedir = false, // <-- Added new config property
        } = currentConfig;

        const filenamesToSave = Array.isArray(filename) ? filename : [filename];
        const filesToSave = uxioObject.files.filter((f) =>
          filenamesToSave.includes(f.fieldname),
        );

        // Handle the 'required' flag
        if (required && filesToSave.length === 0) {
          throw new FileSaveError(
            `Required files not found for fields: ${filenamesToSave.join(", ")}.`,
            404,
          );
        }

        // Skip to the next config if no files match but are not required
        if (filesToSave.length === 0) {
          continue;
        }

        // --- NEW LOGIC FOR MAKEDIR FLAG ---
        // Check if the destination directory exists and handle creation based on the flag.
        try {
          await fs.promises.access(destinationPath);
        } catch (err) {
          // If the directory doesn't exist (ENOENT error)
          if (err.code === 'ENOENT') {
            if (makedir) {
              // Create the directory recursively if `makedir` is true
              await fs.promises.mkdir(destinationPath, { recursive: true });
            } else {
              // Throw an error if the directory doesn't exist and `makedir` is false
              throw new FileSaveError(`Destination directory not found: ${destinationPath}`, 404);
            }
          } else {
            // Re-throw any other type of error
            throw err;
          }
        }

        // --- FILE-BY-FILE PROCESSING LOOP ---
        for (const fileToSave of filesToSave) {
          // 1. Validation Logic
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

          // 2. Renaming
          const newFilename = typeof rename === "function" ? rename(fileToSave) : fileToSave.filename;
          const finalFilePath = path.join(destinationPath, newFilename);

          // Check if a file with the same name already exists to prevent overwriting
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

          // 3. Move the file from temp cache to final destination
          await fs.promises.rename(fileToSave.tempFilePath, finalFilePath);
          savedFilePathsForRollback.push(finalFilePath);

          // 4. Create and store the file info
          const fileInfo = {
            fieldname: fileToSave.fieldname,
            originalName: fileToSave.filename,
            path: finalFilePath,
            size: fileToSave.size,
            mimeType: fileToSave.mimetype,
          };
          savedFilesInfo.push(fileInfo);
        } // End of file-by-file loop
      } // End of main config loop
    } catch (err) {
      // --- ERROR HANDLING AND ROLLBACK ---
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
};

module.exports = files;
