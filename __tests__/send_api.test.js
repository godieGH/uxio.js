const request = require('supertest');
const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const http = require('http');

// Import your main middleware and the files object
const Uxio = require('../index.js'); // Adjust the path if needed

// Mock Express app for testing
const app = express();
app.use(Uxio());

// Create a dummy file for tests
const DUMMY_FILE_PATH = path.join(__dirname, 'dummy.txt');
const DUMMY_IMAGE_PATH = path.join(__dirname, 'dummy.png');

// A simple mock server to handle custom HTTP uploads
let mockHttpServer;
const mockHttpServerPort = 3001;
let receivedFiles = {};

beforeAll(async () => {
  // Create dummy files
  await fs.writeFile(DUMMY_FILE_PATH, 'This is a test file.');
  await fs.writeFile(DUMMY_IMAGE_PATH, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));

  // Start the mock HTTP server
  mockHttpServer = http.createServer((req, res) => {
    if (req.url === '/api/' && req.method === 'POST') {
      const chunks = [];
      req.on('data', chunk => {
        chunks.push(chunk);
      });
      req.on('end', () => {
        // Here we can inspect the received data. For this test, we just confirm it's received.
        // We'll simulate a successful response.
        const fileData = Buffer.concat(chunks);
        const boundary = req.headers['content-type'].split('boundary=')[1];
        
        // This is a very simplified parser, not robust for all cases, but enough for this test.
        const fileMatch = fileData.toString().match(/filename="(.*?)"/);
        const fieldMatch = fileData.toString().match(/name="(.*?)"/);
        
        if (fileMatch && fieldMatch) {
          const filename = fileMatch[1];
          const fieldname = fieldMatch[1];
          receivedFiles[fieldname] = {
            filename: filename,
            size: fileData.length,
            received: true,
          };
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'File uploaded successfully' }));
      });
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  await new Promise(resolve => mockHttpServer.listen(mockHttpServerPort, resolve));
});

afterAll(async () => {
  // Clean up dummy files
  await fs.unlink(DUMMY_FILE_PATH).catch(() => {});
  await fs.unlink(DUMMY_IMAGE_PATH).catch(() => {});

  // Close the mock HTTP server
  await new Promise(resolve => mockHttpServer.close(resolve));
});

// Mock environment variables for S3 tests
const mockS3 = {
  S3_BUCKET_NAME: "test-bucket",
  S3_REGION: "us-east-1",
  S3_SECRET_ACCESS_KEY: "mock-secret-access-key",
  S3_ACCESS_KEY_ID: "mock-access-key-id",
};

// Mock AWS S3 client methods
jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: jest.fn(() => ({
      send: jest.fn(() => Promise.resolve({ ETag: 'mock-etag' })),
    })),
    PutObjectCommand: jest.fn(() => ({})),
  };
});

describe('Uxio File Upload to External Services Tests', () => {

  // Define the route handlers for our tests
  app.post('/custom-http-upload', async (req, res) => {
    const uxio = req.uxio;
    try {
      const fileInfo = await Uxio.files.send(
        [
          {
            filename: 'avatar',
            provider: 'customHttp',
            options: {
              url: `http://localhost:${mockHttpServerPort}/api/`,
            },
          },
          {
            filename: 'file',
            provider: 'customHttp',
            options: {
              url: `http://localhost:${mockHttpServerPort}/api/`,
            },
          }
        ],
        uxio
      );
      res.json(fileInfo);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  app.post('/s3-upload', async (req, res) => {
    const uxio = req.uxio;
    try {
      const fileInfo = await Uxio.files.send(
        {
          filename: "avatar",
          provider: "s3",
          required: true,
          rename: (file) => `avatars/${Date.now()}-${file.filename}`,
          validations: {
            maxSize: 5 * 1024 * 1024, // 5 MB
            mimeType: ["image/jpeg", "image/png"],
          },
          options: {
            bucket: mockS3.S3_BUCKET_NAME,
            region: mockS3.S3_REGION,
            credentials: {
              accessKeyId: mockS3.S3_ACCESS_KEY_ID,
              secretAccessKey: mockS3.S3_SECRET_ACCESS_KEY,
            },
          },
        },
        uxio
      );
      res.json(fileInfo);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  test('should successfully upload multiple files to a custom HTTP endpoint', async () => {
    // Reset received files before the test
    receivedFiles = {};

    const res = await request(app)
      .post('/custom-http-upload')
      .attach('avatar', DUMMY_IMAGE_PATH)
      .attach('file', DUMMY_FILE_PATH);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toHaveProperty('fieldname', 'avatar');
    expect(res.body[1]).toHaveProperty('fieldname', 'file');
    
    // Check if files were received by the mock server
    expect(receivedFiles).toHaveProperty('avatar');
    expect(receivedFiles).toHaveProperty('file');
    expect(receivedFiles.avatar.received).toBe(true);
    expect(receivedFiles.file.received).toBe(true);
  });

  test('should successfully upload a file to a mocked S3 service', async () => {
    const res = await request(app)
      .post('/s3-upload')
      .attach('avatar', DUMMY_IMAGE_PATH);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toHaveProperty('fieldname', 'avatar');
    // The path property should reflect the 'rename' function's output
    expect(res.body[0]).toHaveProperty('path', expect.stringContaining('avatars/'));
    // The provider specific properties should be present
    expect(res.body[0]).toHaveProperty('provider', 's3');
    expect(res.body[0]).toHaveProperty('bucket', mockS3.S3_BUCKET_NAME);
  });

  test('should fail with a mime type validation error for S3 upload', async () => {
    const res = await request(app)
      .post('/s3-upload')
      .attach('avatar', DUMMY_FILE_PATH); // Uploading a text file instead of an image

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', expect.stringContaining('Invalid mime type'));
  });

  test('should fail with a required file missing error for S3 upload', async () => {
    const res = await request(app)
      .post('/s3-upload')
      .attach('something-else', DUMMY_IMAGE_PATH);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', expect.stringContaining('Required files not found'));
  });
});
