# Uxio.js
A simple yet powerful Node.js (express.js) middleware, providing backend tools and Optimisazions feature, i.e handling multipart/form-data file uploads with fine-grained control over the saving process and much more other simplified backend tasks. 

**We are still working on other Web frameworks too, i.e for node, python, ruby and others**

## Uxio.js File Upload
> Uxio decouples file parsing from file saving, allowing you to run custom business logic and validations within your route handlers before committing files to permanent storage.

Features
 * Two-Stage Process: Separates file parsing (handled by app level middleware) from file saving (explicitly called in the route).
 * Granular Control: Provides a robust save method that allows for different configurations (validations, paths, renaming) for multiple files in a single request.
 * Data Integrity: Implements an automatic rollback mechanism that cleans up any partially saved files if an error occurs during the save operation.
 * Customizable Validation: Easily set maximum file size and allowed MIME types per file.
 * Dynamic Renaming: Use a custom function to rename files based on their metadata.
 * Predictable Error Handling: Throws a custom FileSaveError with a status code for consistent error handling.
 * Flexible Configuration: Use optional flags like `required` to enforce file presence and `makedir` to automatically create destination directories.

### Installation
```bash
npm install uxio
```

Usage
First, integrate the Uxio middleware into your Express application. Then, just call the `Uxio.files.save()` method within your route handlers to process the uploaded files.

``` javascript
const Uxio = require('uxio')
// in your app level server.js just before any middle to ensure it capture every http-request first
app.use(Uxio()); // This will capture all multipart/form-data and parse it, passing the file(s) object to req.uxio

// in your routes handlers you can just
const uxio = req.uxio; // This will hold the file(s) object
const savedFiles = await Uxio.files.save({
   filename: 'avatar', // specify the field name(s) you want to upload if multiple files have same field name(s), all will be saved at once
   path: path.join(__dirname, 'uploads'),  // sepecify save destination
   rename: (file) => `${Date.now()}${path.extname(file.filename)}`, // This allows to apply renaming function to your saved file(s)
   Validations: {
      mimeType: ['image/png', 'audio/mp3'], //filter with mimetypes, can be a string or an array of valid mimetypes | default is all types
      size: 5*1024*1024, // 5MB | filter with size 
   },
   makedir: true, // don't throw an error if path doesn't exist, create the path recursively
   required: true // All the specified filename should be present | if false (default) it won't throw error if fieldname name is not found will just skip saving to another file
}, uxio);
```


#### Passing an array of config objects
``` javascript
const fileInfo = await Uxio.files.save([{/* options */}, {/* options */}], uxio) // you can use this to handle different fields with custom path, Validations etc
```

### API Reference
- Uxio(options) Middleware
The middleware parses multipart/form-data and attaches a req.uxio object to the request. It caches all files to a temporary directory.
`req.uxio Object`

| Property | Type | Description |
|---|---|---|
| files | array | An array of objects, where each object contains metadata for a cached file. |
| hasFile | boolean | A getter that returns true if any file was uploaded. |
| hasFiles | function | Checks if one or more files with the specified fieldname(s) were uploaded. |
| cleanup | function | A method to manually clean up the temporary cache directory. (Called automatically on res.finish or res.close). |

### The `Uxio.files.save(config, uxioObject)` method
This is the main function for saving form uploaded file(s) to their disired final destination.
Parameters
 * config: object or array of object. The configuration(s) for saving files.
 * uxioObject: object. The req.uxio object from the middleware.

Configuration Object Properties
| Property | Type | Required | Description |
|---|---|---|---|
| filename | string or string[] | Yes | The fieldname of the file(s) to save. |
| path | string | Yes | The destination directory path to save the files. |
| required | boolean | No | If true, an error will be thrown if no files match the filename. Defaults to false. |
| makedir | boolean | No | If true, the path directory will be created recursively if it doesn't exist. Defaults to false. |
| validations | object | No | An object for validation rules. |
| validations.maxSize | number | No | Maximum file size in bytes. |
| validations.mimeType | string or string[] | No | Allowed MIME types (e.g., ['image/jpeg', 'image/png']). |
| rename | function | No | A function (file) => newFilename to rename the file. Defaults to using the original filename. |

Returns
A Promise that resolves to an array of objects, each containing metadata for a successfully saved file.

Error Handling
This library throws a custom FileSaveError class with a status property. This allows for specific error handling in routes.

``` javascript
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



### The `Uxio.files.send(config, uxioObject)` method
This function sends multipart/form-data uploaded to an external destination over a network, such as cloud storage or a custom server.
For now it supports `s3` and `customHttp` services, we are still working to build up other cloud service supports

Note: Yet we still don't recommend you using this method for production until you(we) pass it  approved, verified and secured, it is still under development, so walk with cautions

Parameters
 * config: object | object[]. The configuration(s) for sending files.
 * uxioObject: object. The req.uxio object from the middleware.

Configuration Object Properties
| Property | Type | Required | Description |
|---|---|---|---|
| filename | string \| string[] | Yes | The fieldname of the file(s) to send. |
| provider | string | Yes | The destination service provider. Supported values: 's3', 'customHttp'. |
| options | object | Yes | Provider-specific options. See details below. |
| required | boolean | No | If true, an error is thrown if no files match the filename. Defaults to false. |
| validations | object | No | An object for validation rules (same as save). |
| rename | function | No | A function (file) => newFilename to rename the file before sending. |

#### Provider options Details
 * For provider: `'s3'`:
   * `options.bucket`: (string) The name of your S3 bucket.
   * `options.region`: (string) The AWS region of your bucket (e.g., 'us-east-1').
   * `options.credentials`: (object) Your AWS credentials `({ accessKeyId, secretAccessKey })`.
 * For provider: `'customHttp'`:
   * `options.url`: (string) The full URL of the endpoint that will receive the file.
   * `options.axiosConfig`: (object, optional) A standard Axios config object for custom headers, etc. **You might pass through axios documentations to understand these**

Returns
A Promise that resolves to an array of objects, each containing metadata from the external provider's response (e.g., S3 object URL, key, bucket).
- The response information might differ or depend on Configuration(s) or the way way the services handle the sent file, if well configured can return back a full enough file(s) info

Error Handling
Both save and send methods throw a custom `FileSaveError` class with a status property. This allows for specific and consistent error handling in your routes.
