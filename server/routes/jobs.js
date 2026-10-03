const express = require('express');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const Busboy = require('busboy');
const logger = require('../logger');
const jobs = require('../jobs');
const { SUPPORTED_TYPES } = require('../processor');

const MAX_BYTES = 5 * 1024 * 1024;
// Bodies far beyond the limit are refused from Content-Length alone instead of being streamed and discarded.
const HARD_LIMIT_BYTES = 50 * 1024 * 1024;
const fail = (res, status, code, message, data) => res.status(status).json({ success: false, error: { code, message }, ...(data ? { data } : {}), requestId: res.req.requestId });

function cleanName(raw) {
  const name = path.basename(String(raw || '').replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  return name || 'unnamed';
}
const typeOf = name => path.extname(name).slice(1).toLowerCase() || 'none';
const logFields = job => ({ job_id: jobs.publicId(job.id), job_status: job.status, file_name: job.file_name, file_type: job.file_type, file_size_bytes: job.file_size_bytes, ...(job.demo ? { demo: job.demo } : {}) });

// Write the file before inserting the row, so the worker can never claim a job whose file is not there yet.
async function queueUpload(db, uploadDir, { fileName, fileType, buffer, demo = null, requestId }) {
  const storedPath = `${crypto.randomUUID()}.${fileType}`;
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(path.join(uploadDir, storedPath), buffer);
  const job = jobs.createJob(db, { fileName, fileType, fileSizeBytes: buffer.length, storedPath, demo, requestId });
  logger.info({ event: 'job_queued', request_id: requestId, ...logFields(job) }, 'Job queued');
  return job;
}

function rejectUpload(db, req, res, { fileName, fileType, size, status, reason, message }) {
  const job = jobs.createRejectedJob(db, { fileName, fileType, fileSizeBytes: size, reason, message, requestId: req.requestId });
  logger.warn({ event: 'upload_rejected', request_id: req.requestId, ...logFields(job), failure_reason: reason }, 'Upload rejected');
  logger.warn({ event: 'job_failed', request_id: req.requestId, ...logFields(job), failure_stage: 'validation', failure_reason: reason, failure_message: message }, 'Job failed');
  res.locals.logMessage = 'Upload rejected';
  return fail(res, status, reason, message, jobs.toResponse(job));
}

module.exports = (db, uploadDir) => {
  const router = express.Router();

  router.post('/', (req, res, next) => {
    const declared = Number(req.headers['content-length']) || 0;
    const refuse = (status, reason, message) => {
      logger.warn({ event: 'upload_rejected', request_id: req.requestId, failure_reason: reason }, 'Upload rejected');
      res.locals.logMessage = 'Upload rejected'; res.set('Connection', 'close');
      return fail(res, status, reason, message);
    };
    if (!req.is('multipart/form-data')) return refuse(400, 'NO_FILE', 'Send the file as multipart/form-data in a field named "file".');
    if (declared > HARD_LIMIT_BYTES) return refuse(413, 'FILE_TOO_LARGE', 'Files must be 5 MB or smaller.');
    let parser;
    try { parser = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_BYTES + 1, fields: 5, parts: 6 } }); } catch (_) { return refuse(400, 'INVALID_UPLOAD', 'The upload could not be read.'); }

    let upload = null, failed = false;
    parser.on('file', (field, stream, info) => {
      if (field !== 'file' || upload) { stream.resume(); return; }
      upload = { fileName: cleanName(info.filename), chunks: [], size: 0, truncated: false };
      stream.on('data', chunk => { upload.chunks.push(chunk); upload.size += chunk.length; });
      stream.on('limit', () => { upload.truncated = true; });
    });
    parser.on('error', () => { failed = true; if (!res.headersSent) refuse(400, 'INVALID_UPLOAD', 'The upload could not be read.'); });
    parser.on('close', async () => {
      if (failed || res.headersSent) return;
      if (!upload) return refuse(400, 'NO_FILE', 'Choose a .csv or .txt file to upload in the "file" field.');
      const { fileName } = upload, fileType = typeOf(fileName), tooLarge = upload.truncated || upload.size > MAX_BYTES;
      // Busboy stops counting at its limit (one byte past ours), so the declared body size is the better estimate.
      const size = tooLarge ? Math.max(declared, upload.size) : upload.size;
      logger.info({ event: 'upload_received', request_id: req.requestId, file_name: fileName, file_type: fileType, file_size_bytes: size }, 'Upload received');
      if (!SUPPORTED_TYPES.includes(fileType)) return rejectUpload(db, req, res, { fileName, fileType, size, status: 415, reason: 'UNSUPPORTED_FILE_TYPE', message: 'Only .csv and .txt files can be processed.' });
      if (tooLarge) return rejectUpload(db, req, res, { fileName, fileType, size, status: 413, reason: 'FILE_TOO_LARGE', message: 'Files must be 5 MB or smaller.' });
      try {
        const job = await queueUpload(db, uploadDir, { fileName, fileType, buffer: Buffer.concat(upload.chunks), requestId: req.requestId });
        res.locals.logMessage = 'Upload accepted';
        res.status(201).json({ success: true, data: jobs.toResponse(job), requestId: req.requestId });
      } catch (error) { error.code = 'UPLOAD_STORAGE_FAILED'; error.publicMessage = 'The file could not be stored.'; next(error); }
    });
    req.pipe(parser);
  });

  router.get('/', (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : '';
    const limit = req.query.limit === undefined ? 20 : Number(req.query.limit), offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
    if ((status && !jobs.STATUSES.includes(status)) || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) return fail(res, 400, 'VALIDATION_ERROR', 'Invalid status or pagination parameters.');
    res.json({ success: true, data: jobs.listJobs(db, { status, limit, offset }).map(jobs.toResponse), requestId: req.requestId });
  });

  router.get('/stats', (req, res) => res.json({ success: true, data: { ...jobs.jobStats(db), worker: jobs.workerStatus(db) }, requestId: req.requestId }));

  router.get('/:id', (req, res) => {
    const id = jobs.parseJobId(req.params.id);
    if (!id) return fail(res, 400, 'JOB_ID_INVALID', 'Job IDs look like JOB-1042.');
    const job = jobs.getJob(db, id);
    if (!job) return fail(res, 404, 'JOB_NOT_FOUND', 'Job not found.');
    res.json({ success: true, data: jobs.toResponse(job), requestId: req.requestId });
  });

  return router;
};
module.exports.queueUpload = queueUpload;
module.exports.MAX_BYTES = MAX_BYTES;
