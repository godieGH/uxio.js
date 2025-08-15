# Uxio.js

A simple yet powerful Node.js (Express.js) middleware that provides backend tools and optimization features such as handling `multipart/form-data` file uploads with fine-grained control over the saving process, as well as many other simplified backend tasks.

**We are actively developing support for other web frameworks, including those for Node, Python, Ruby, and more.**

---

## Uxio.js File Upload

> Uxio separates file parsing from file saving, allowing you to run custom business logic and validations within your route handlers before committing files to permanent storage.

### Features

- **Two-Stage Process:** Separates file parsing (handled by app-level middleware) from file saving (explicitly called in the route).
- **Granular Control:** Provides a robust save method supporting different configurations (validations, paths, renaming) for multiple files in a single request.
- **Data Integrity:** Automatically rolls back and cleans up any partially saved files if an error occurs during the save operation.
- **Customizable Validation:** Easily set maximum file size and allowed MIME types per file.
- **Dynamic Renaming:** Use a custom function to rename files based on their metadata.
- **Predictable Error Handling:** Throws a custom `FileSaveError` with a status code for consistent error handling.
- **Flexible Configuration:** Use optional flags like `required` to enforce file presence and `makedir` to automatically create destination directories.

---

### Installation

```bash
npm install uxio
```

---

### Usage

First, integrate the Uxio middleware into your Express application. Then, call the `Uxio.files.save()` method within your route handlers to process uploaded files.

```js
const Uxio = require('uxio');

// In your main server.js, add this before any other middleware to ensure it captures every HTTP request first
app.use(Uxio()); // This handles all multipart/form-data, parsing files and attaching them to req.uxio

// In your route handlers:
const uxio = req.uxio; // This holds the file(s) object
const savedFiles = await Uxio.files.save({
   filename: 'avatar', // Specify the field name(s) you want to upload; if multiple files use the same field name, all will be saved at once
   path: path.join(__dirname, 'uploads'),  // Specify the destination for saving files
   rename: (file) => `${Date.now()}${path.extname(file.filename)}`, // Apply a renaming function to your saved files
   validations: {
      mimeType: ['image/png', 'audio/mp3'], // Filter by MIME types; can be a string or an array. Defaults to all types.
      size: 5*1024*1024, // 5MB - filter by file size 
   },
   makedir: true, // If the path doesn't exist, create it recursively instead of throwing an error
   required: true // All specified filenames must be present. If false (default), missing fields will be skipped.
}, uxio);
```

#### Handling Multiple File Fields

You can pass an array of configuration objects to handle different fields with custom paths, validations, and more:

```js
const fileInfo = await Uxio.files.save([{/* options */}, {/* options */}], uxio);
```

---

### API Reference

#### Uxio(options) Middleware

The middleware parses `multipart/form-data` and attaches a `req.uxio` object to the request. Files are cached in a temporary directory.

**`req.uxio` Object Properties**

| Property   | Type     | Description                                                                                 |
|------------|----------|---------------------------------------------------------------------------------------------|
| files      | array    | An array of objects containing metadata for each cached file.                               |
| hasFile    | boolean  | A getter that returns `true` if any file was uploaded.                                      |
| hasFiles   | function | Checks if one or more files with the specified field name(s) were uploaded.                 |
| cleanup    | function | Manually clean up the temporary cache directory. (Automatically called on `res.finish` or `res.close`.) |

---

#### `Uxio.files.save(config, uxioObject)`

The main function for saving uploaded files to their final destination.

**Parameters:**

- `config`: Object or array of objects. The configuration(s) for saving files.
- `uxioObject`: The `req.uxio` object from the middleware.

**Configuration Object Properties**

| Property            | Type               | Required | Description                                                                    |
|---------------------|--------------------|----------|--------------------------------------------------------------------------------|
| filename            | string or string[] | Yes      | The field name(s) of the file(s) to save.                                      |
| path                | string             | Yes      | The directory path where files will be saved.                                  |
| required            | boolean            | No       | If true, throws an error if no files match the filename. Defaults to false.    |
| makedir             | boolean            | No       | If true, creates the directory path recursively if it doesn't exist.           |
| validations         | object             | No       | Validation rules for files.                                                    |
| validations.maxSize | number             | No       | Maximum file size in bytes.                                                    |
| validations.mimeType| string or string[] | No       | Allowed MIME types (e.g., ['image/jpeg', 'image/png']).                        |
| rename              | function           | No       | Function `(file) => newFilename` to rename the file. Defaults to the original filename. |

**Returns:**  
A Promise that resolves to an array of objects, each containing metadata for a successfully saved file.

**Error Handling:**  
Throws a custom `FileSaveError` class with a `status` property for specific error handling in your routes.

```js
try {
   await Uxio.files.save(...);
} catch (e) {
   if (e.status === 404) {
      // Directory not found or required file is missing
   } else if (e.status === 400) {
      // Validation error (size or type)
   }
   res.status(e.status || 500).json({ error: e.message });
}
```

---

#### `Uxio.files.send(config, uxioObject)`

Sends uploaded files to an external destination over the network, such as cloud storage or a custom server.

> **Note:** Currently supports `s3` and `customHttp` providers.  
> **Warning:** This feature is under development and not recommended for production until it has been fully verified and secured.

**Parameters:**

- `config`: Object or array of objects. The configuration(s) for sending files.
- `uxioObject`: The `req.uxio` object from the middleware.

**Configuration Object Properties**

| Property      | Type                | Required | Description                                                                    |
|---------------|---------------------|----------|--------------------------------------------------------------------------------|
| filename      | string or string[]  | Yes      | The field name(s) of the file(s) to send.                                      |
| provider      | string              | Yes      | The destination service provider. Supported values: `'s3'`, `'customHttp'`.    |
| options       | object              | Yes      | Provider-specific options. See below.                                          |
| required      | boolean             | No       | If true, throws an error if no files match the filename. Defaults to false.    |
| validations   | object              | No       | Validation rules for files (same as in `save`).                                |
| rename        | function            | No       | Function `(file) => newFilename` to rename the file before sending.            |

**Provider Options**

- For provider: `'s3'`:
  - `options.bucket`: (string) The name of your S3 bucket.
  - `options.region`: (string) The AWS region of your bucket (e.g., `'us-east-1'`).
  - `options.credentials`: (object) Your AWS credentials `{ accessKeyId, secretAccessKey }`.
- For provider: `'customHttp'`:
  - `options.url`: (string) The full URL of the endpoint to receive the file.
  - `options.axiosConfig`: (object, optional) Axios config for custom headers and other options.  
    See [Axios documentation](https://axios-http.com/docs/req_config) for details.

**Returns:**  
A Promise that resolves to an array of objects, each containing metadata from the external provider’s response (e.g., S3 object URL, key, or bucket).  
Response information may vary depending on configuration and provider.

**Error Handling:**  
Both `save` and `send` methods throw a custom `FileSaveError` class with a `status` property for consistent error handling.

---

## License

[MIT](./LICENSE)