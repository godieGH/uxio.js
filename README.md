# Uxio

A simple yet powerful Node.js (Express.js) middleware that provides backend tools and optimization features such as handling `multipart/form-data` file uploads with fine-grained control over the saving process, as well as many other simplified backend tasks.

We are actively developing support for other web frameworks, including those for Node, Python, Ruby, and more.
> [read more here](https://godiegh.github.io/uxio.js/module-files.html#~validations) to contribute.
---

## Uxio File Upload

> Uxio separates file parsing from file saving, allowing you to run custom business logic and validations within your route handlers before committing files to permanent storage.

### Key change: `fieldname` (preferred) vs `filename` (deprecated)

Uxio now uses `fieldname` as the canonical configuration key to identify which uploaded form field(s) should be processed. The older `filename` key is deprecated but still supported for backward compatibility — Uxio will emit a deprecation warning when `filename` is used and will continue to process it for now. Please migrate to `fieldname` because `filename` will be removed in a future major release.

- Preferred: `fieldname` — corresponds to the form input name (e.g., `<input name="avatar" type="file" />`).
- Deprecated: `filename` — kept only for backward compatibility; please migrate to `fieldname`.

---

### Features

- Two-Stage Process: separates file parsing (handled by app-level middleware) from file saving (explicitly called in the route).
- Granular Control: robust `save()` and `send()` methods supporting different configurations (validations, paths, renaming) for multiple files in a single request.
- Data Integrity: automatically rolls back and cleans up any partially saved files if an error occurs during the save operation.
- Customizable Validation: per-config `validations.maxSize` and `validations.mimeType`.
- Dynamic Renaming: use a custom function to rename files based on metadata.
- Predictable Error Handling: throws a custom `FileSaveError` with a `status` code for consistent error handling.
- Flexible Configuration: `required`, `makedir`, and batch configs (arrays) supported.

---

### Installation

```bash
npm install uxio
```

---

### Quick Usage

Integrate the Uxio middleware into your Express application. Call `Uxio.files.save()` in route handlers to persist uploaded files only after your business logic and validations have passed.

```js
const express = require('express');
const path = require('path');
const Uxio = require('uxio');

const app = express();
app.use(Uxio()); // parse multipart/form-data and attach req.uxio

app.post('/upload', async (req, res) => {
  const uxio = req.uxio;

  try {
    const savedFiles = await Uxio.files.save({
      fieldname: 'avatar',
      path: path.join(__dirname, 'uploads'),
      rename: (file) => `${Date.now()}${path.extname(file.filename)}`,
      validations: {
        maxSize: 5 * 1024 * 1024, // 5 MB
        mimeType: ['image/png', 'image/jpeg'],
      },
      makedir: true,
      required: true,
    }, uxio);

    res.json({ saved: savedFiles });
  } catch (err) {
    // err is a FileSaveError with .status in most expected cases
    res.status(err.status || 500).json({ error: err.message });
  }
});
```

---

#### Handling Multiple File Fields

Pass an array of configuration objects to handle different fields with custom paths, validations, and more:

```js
const results = await Uxio.files.save([
  {
    fieldname: 'avatar',
    path: path.join(__dirname, 'uploads/avatars'),
    validations: { maxSize: 2 * 1024 * 1024 },
    rename: (f) => `avatar-${Date.now()}${path.extname(f.filename)}`,
    makedir: true,
  },
  {
    fieldname: ['documents', 'contracts'],
    path: path.join(__dirname, 'uploads/docs'),
    validations: { mimeType: ['application/pdf'] },
    makedir: true,
  }
], req.uxio);
```

---

## API Reference

### Uxio(options) Middleware

The middleware parses `multipart/form-data` and attaches a `req.uxio` object to the request. Files are cached in a temporary directory.

`req.uxio` object properties:

| Property  | Type     | Description |
|-----------|----------|-------------|
| files     | array    | An array of objects containing metadata for each cached file (each has: fieldname, filename, tempFilePath, size, mimeType, etc.). |
| hasFile   | getter (boolean) | Returns `true` if any file was uploaded. |
| hasFiles(fieldnameOrArray) | function | Checks if one or more files with the specified field name(s) were uploaded. |
| cleanup() | function | Manually clean up the temporary cache directory (automatically called on `res.finish` / `res.close`). |

Notes about the `files` array: each file object supplied by the middleware typically includes:
- fieldname: the form input name
- filename: original filename (string)
- tempFilePath: path to temporary cached file
- size: file size in bytes
- mimeType: MIME type
- other metadata that may be added by middleware or helpers

---

### Uxio.files.save(config, uxioObject)

Saves uploaded files to their final filesystem destination.

Parameters:
- config: object or array of objects. Each config must specify `fieldname` (string or string[]).
- uxioObject: the `req.uxio` object.

Configuration properties:

| Property | Type | Required | Description |
|---|---:|:---:|---|
| fieldname | string \| string[] | Yes | The form field name(s) of the file(s) to save. |
| path | string | Yes | Destination directory path. |
| required | boolean | No (default false) | If true, throw if no files are found for the specified field(s). |
| makedir | boolean | No | If true, create destination directory recursively if missing. |
| validations | object | No | Validation rules. See below. |
| rename | function | No | `(file) => newFilename` — a function that returns the new filename. |

Validation object:

| Property | Type | Description |
|---|---:|---|
| maxSize | number | Maximum size in bytes. |
| mimeType | string \| string[] | Allowed MIME types (e.g. `['image/png']` or `'image/png,image/jpeg'`). |

Returns:
- Promise resolving to an array of saved file info objects:
  - { fieldname, originalName, path, size, mimeType, ...metadata }

Behavior highlights:
- If a directory does not exist and `makedir: true`, Uxio will create it recursively.
- If a file already exists at the target final path, a `FileSaveError` with status `409` is thrown.
- On any failure during the save process, previously saved files from the same call are deleted (rollback). The method attempts best-effort cleanup and will log cleanup errors.

---

### Uxio.files.send(config, uxioObject)

Sends uploaded files to an external provider (e.g., S3, custom HTTP endpoint).

Parameters:
- config: object or array of objects (each must include `fieldname` and `provider`).
- uxioObject: `req.uxio`.

Configuration properties:

| Property | Type | Required | Description |
|---|---:|:---:|---|
| fieldname | string \| string[] | Yes | The form field name(s) to send. |
| provider | string | Yes | Supported: `s3`, `customHttp`. |
| options | object | Yes | Provider-specific. |
| validations | object | No | Same format as `save()`. |
| rename | function | No | `(file) => newFilename` |

Provider options:

- s3:
  - options.bucket (string)
  - options.region (string)
  - options.credentials (object compatible with AWS SDK v3)
- customHttp:
  - options.url (string) — destination endpoint
  - options.axiosConfig (object) — optional axios config

Return:
- Promise resolving to an array of objects describing provider responses and file metadata.

Rollback:
- For S3: Uxio attempts to delete already-uploaded objects if a later step fails (best-effort).
- For customHttp: rollback is not implemented generically because it depends on the remote service exposing a deletion API. The README and code annotate this limitation.

---

## Error Handling — details and examples

Uxio uses a custom `FileSaveError` class to provide predictable errors and HTTP-friendly status codes in most expected failure cases. When `FileSaveError` is thrown, it includes:
- message (string)
- status (number) — HTTP-style status code representing the error

Common failure conditions and status codes:

| Condition | Thrown status | Explanation |
|---|---:|---|
| Missing required files | 404 | `required: true` and no files received for the requested field(s). |
| Destination directory not found | 404 | `path` does not exist and `makedir` is false. |
| File already exists (name collision) | 409 | Target filename exists at destination. |
| Validation failed (size or mime) | 400 | File exceeds `validations.maxSize` or MIME not allowed. |
| Provider config missing/invalid | 400 | Missing required provider options (e.g., S3 bucket/region/credentials). |
| Unsupported provider | 400 | Provider not supported by `send()`. |
| Unexpected internal error | 500 | Any unexpected runtime error — wrapped in `FileSaveError` with status 500. |

Express handler example demonstrating user-friendly responses:

```js
app.post('/upload', async (req, res) => {
  try {
    const saved = await Uxio.files.save({ fieldname: 'avatar', path: '/data/uploads', makedir: true }, req.uxio);
    res.status(201).json({ saved });
  } catch (err) {
    // err may be FileSaveError or an unexpected Error
    const code = err && err.status ? err.status : 500;
    res.status(code).json({
      error: err.message,
      code,
    });
  }
});
```

Logging and diagnostics:
- Uxio logs rollback attempts and any cleanup errors to console.error.
- For production apps, capture these logs with a structured logger and include request and user context for easier triage.

Rollback semantics (summary):
- save(): If a later file in a batch fails, files already moved to destination from the same save() call are unlinked (deleted) as a rollback.
- send() → s3: If some uploads succeed and a later one fails, Uxio attempts to delete the previously uploaded S3 objects. Success depends on correct credentials/options being used for deletion.
- send() → customHttp: Rollback is not implemented generically. If your target endpoint supports deletion, implement a custom provider integration or add a server-side delete call.

---

## Examples: `send()` (S3 and custom HTTP)

S3 example:

```js
const uploadResults = await Uxio.files.send({
  fieldname: ['photos', 'images'],
  provider: 's3',
  options: {
    bucket: 'my-bucket',
    region: 'us-east-1',
    credentials: { accessKeyId: 'AK...', secretAccessKey: '...' }
  },
  rename: (file) => `user-${file.fieldname}-${Date.now()}${path.extname(file.filename)}`,
  validations: { maxSize: 10 * 1024 * 1024 }
}, req.uxio);
```

customHttp example:

```js
const results = await Uxio.files.send({
  fieldname: 'report',
  provider: 'customHttp',
  options: {
    url: 'https://uploads.example.com/api/upload',
    axiosConfig: { timeout: 30000 }
  }
}, req.uxio);
```

Note: For `customHttp`, the response shape depends on the remote server — Uxio will merge returned data with local metadata for the result.

---

## Migration guide: move from `filename` to `fieldname`

If your code/configs use the old `filename` property, migrate to `fieldname`:

1. Replace property names in code and config:
   - Old: `{ filename: 'avatar', path: '...' }`
   - New: `{ fieldname: 'avatar', path: '...' }`
2. If you passed arrays: `{ filename: ['a','b'] }` → `{ fieldname: ['a','b'] }`
3. Validation keys:
   - Use `validations.maxSize` (not `validations.size`) and `validations.mimeType`.
4. Behavior note:
   - Uxio will emit a console deprecation warning when `filename` is used, and still process it for now.
   - `filename` will be removed in a future major release — please update before upgrading to the next major.

Quick find/replace example (project root):

```bash
# GNU sed example: replace filename: with fieldname: in .js and .json files
grep -R --include=\*.js --include=\*.json -n "filename:" . | cut -d: -f1 | uniq | xargs -I{} sed -i "s/filename:/fieldname:/g" {}
```

(Review changes before committing — the replacement is mechanical and may require manual verification.)

---

## Common patterns and best practices

- Validate files in your route before calling `save()` when you need business-logic checks beyond size/mime.
- Use `makedir: true` in production when saving to path-based destinations to avoid 404 directory errors.
- Use `rename` to avoid filename collisions and to create deterministic keys/names.
- Capture `FileSaveError` status codes in your API responses for consistent client behavior.
- For S3 uploads in `send()`, provide credentials scoped to the required operations only (least privilege).
- For high-volume uploads consider streaming where possible and minimize blocking ops in the request thread.

---

## Changelog (high level)

- v2.0.0 — Document and prefer `fieldname` over deprecated `filename`. Reintroduced detailed tables and expanded Error Handling and Rollback semantics. Fixed validation key names in examples and improved save/send examples.

---

## License

MIT
