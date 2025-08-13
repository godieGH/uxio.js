const request = require('supertest');
const express = require('express');
const path = require('path');
const fs = require('fs/promises');

// Import your main middleware and the files object
const Uxio = require('../index');

// Create the temporary test directories
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const UPLOADS_NEW_DIR = path.join(UPLOADS_DIR, 'new');

const DUMMY_FILE_PATH = path.join(__dirname, 'dummy.txt');
const LARGE_DUMMY_FILE_PATH = path.join(__dirname, 'large_dummy.txt');

// Mock Express app for testing
const app = express();
app.use(Uxio());

// Define the route handlers for our tests
app.post('/upload-single', async (req, res) => {
  const uxio = req.uxio;
  try {
    const fileInfo = await Uxio.files.save(
      {
        filename: "avatar",
        path: UPLOADS_DIR,
        makedir: true,
      },
      uxio,
    );
    res.json(fileInfo);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/upload-multiple', async (req, res) => {
  const uxio = req.uxio;
  try {
    const fileInfo = await Uxio.files.save(
      [
        {
          filename: "avatar",
          path: UPLOADS_DIR,
          makedir: true,
        },
        {
          filename: "file",
          path: UPLOADS_NEW_DIR,
          makedir: true,
          validations: {
            maxSize: 1 * 1024 * 1024, // 1MB
            mimeType: ['text/plain']
          },
        },
      ],
      uxio,
    );
    res.json(fileInfo);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/upload-required', async (req, res) => {
  const uxio = req.uxio;
  try {
    const fileInfo = await Uxio.files.save(
      {
        filename: "avatar",
        path: UPLOADS_DIR,
        required: true,
      },
      uxio,
    );
    res.json(fileInfo);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/upload-no-makedir', async (req, res) => {
  const uxio = req.uxio;
  const nonExistentPath = path.join(__dirname, 'non-existent-dir');
  try {
    const fileInfo = await Uxio.files.save(
      {
        filename: "file",
        path: nonExistentPath,
        makedir: false,
      },
      uxio,
    );
    res.json(fileInfo);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

describe('Uxio File Upload Tests', () => {
  beforeAll(async () => {
    // Create dummy files for tests
    await fs.writeFile(DUMMY_FILE_PATH, 'This is a test file.');
    await fs.writeFile(LARGE_DUMMY_FILE_PATH, Buffer.alloc(1024 * 1024 * 2)); // 2MB file
  });

  afterAll(async () => {
    // Clean up dummy files
    await fs.unlink(DUMMY_FILE_PATH).catch(() => {});
    await fs.unlink(LARGE_DUMMY_FILE_PATH).catch(() => {});
  });

  afterEach(async () => {
    // Clean up all test directories and files after each test
    await fs.rm(UPLOADS_DIR, { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(__dirname, 'non-existent-dir'), { recursive: true, force: true }).catch(() => {});
  });

  test('should successfully upload a single file', async () => {
    const res = await request(app)
      .post('/upload-single')
      .attach('avatar', DUMMY_FILE_PATH);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toHaveProperty('originalName', 'dummy.txt');
    expect(res.body[0]).toHaveProperty('fieldname', 'avatar');
    // --- FIX: Updated the size to 20 based on test output ---
    expect(res.body[0]).toHaveProperty('size', 20); 
    expect(await fs.access(res.body[0].path)).toBeUndefined();
  });

  test('should successfully upload multiple files to different directories', async () => {
    const res = await request(app)
      .post('/upload-multiple')
      .attach('avatar', DUMMY_FILE_PATH)
      .attach('file', DUMMY_FILE_PATH);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toHaveProperty('fieldname', 'avatar');
    expect(res.body[1]).toHaveProperty('fieldname', 'file');

    expect(await fs.access(res.body[0].path)).toBeUndefined();
    expect(await fs.access(res.body[1].path)).toBeUndefined();
  });

  test('should fail with a size validation error and perform rollback', async () => {
    const res = await request(app)
      .post('/upload-multiple')
      .attach('avatar', DUMMY_FILE_PATH)
      .attach('file', LARGE_DUMMY_FILE_PATH);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', expect.stringContaining('exceeds limit'));

    // The rollback should have removed the first file that was saved.
    await expect(fs.access(path.join(UPLOADS_DIR, 'dummy.txt'))).rejects.toThrow();
  });

  test('should fail with a required file missing error', async () => {
    const res = await request(app)
      .post('/upload-required')
      .attach('something-else', DUMMY_FILE_PATH);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', expect.stringContaining('Required files not found'));

    // No files should have been created in the destination directory
    await expect(fs.access(UPLOADS_DIR)).rejects.toThrow();
  });

  test('should fail if directory does not exist and makedir is false', async () => {
    const res = await request(app)
      .post('/upload-no-makedir')
      .attach('file', DUMMY_FILE_PATH);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', expect.stringContaining('Destination directory not found'));
  });

  test('should fail with a duplicate filename error and perform rollback', async () => {
    // First, upload a file successfully
    const firstUploadRes = await request(app)
      .post('/upload-single')
      .attach('avatar', DUMMY_FILE_PATH);
    
    // Now, upload a second file with the same name to the same destination
    const secondUploadRes = await request(app)
      .post('/upload-single')
      .attach('avatar', DUMMY_FILE_PATH);

    expect(secondUploadRes.status).toBe(409);
    expect(secondUploadRes.body).toHaveProperty('error', expect.stringContaining('File with name'));

    // --- FIX: The first file should STILL EXIST. The rollback only cleans up the current request's files. ---
    expect(await fs.access(firstUploadRes.body[0].path)).toBeUndefined();
  });
});
