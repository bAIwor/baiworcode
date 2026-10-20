import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  isImagePath,
  readImageAsBase64,
  extractImageAttachments,
  buildMultimodalContent,
  processMultimodalPrompt,
} from '../src/chat/multimodal.js';

describe('Multi-Modal & Media Asset Ingestion', () => {
  let tmpDir;
  let samplePng;
  let sampleJpg;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baiwor-multimodal-test-'));
    samplePng = path.join(tmpDir, 'mock.png');
    sampleJpg = path.join(tmpDir, 'mock.jpg');
    // Tulis mock file gambar (buffer kecil)
    fs.writeFileSync(samplePng, Buffer.from('mock-png-bytes-12345'));
    fs.writeFileSync(sampleJpg, Buffer.from('mock-jpg-bytes-67890'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('isImagePath harus mengenali format gambar yang didukung', () => {
    assert.equal(isImagePath('photo.PNG'), true);
    assert.equal(isImagePath('diagram.jpg'), true);
    assert.equal(isImagePath('mockup.webp'), true);
    assert.equal(isImagePath('logo.svg'), true);
    assert.equal(isImagePath('document.pdf'), false);
    assert.equal(isImagePath('code.js'), false);
    assert.equal(isImagePath(''), false);
  });

  it('readImageAsBase64 harus membaca dan mengonversi berkas ke base64', () => {
    const res = readImageAsBase64(samplePng);
    assert.equal(res.success, true);
    assert.equal(res.mimeType, 'image/png');
    assert.equal(res.sizeBytes, Buffer.from('mock-png-bytes-12345').length);
    assert.equal(
      Buffer.from(res.base64, 'base64').toString('utf8'),
      'mock-png-bytes-12345'
    );
  });

  it('readImageAsBase64 harus menolak berkas yang tidak ada', () => {
    const res = readImageAsBase64(path.join(tmpDir, 'non_existent.png'));
    assert.equal(res.success, false);
    assert.match(res.error, /tidak ditemukan/i);
  });

  it('extractImageAttachments harus mengekstrak sintaks @gambar dari prompt', () => {
    const prompt = `Tolong periksa tampilan ini @${samplePng} dan temukan bug CSS.`;
    const res = extractImageAttachments(prompt, { baseDir: tmpDir });

    assert.equal(res.images.length, 1);
    assert.equal(res.images[0].path, samplePng);
    assert.equal(res.cleanText, 'Tolong periksa tampilan ini dan temukan bug CSS.');
    assert.equal(res.errors.length, 0);
  });

  it('extractImageAttachments harus mengekstrak sintaks /image <path> [prompt]', () => {
    const prompt = `/image ${sampleJpg} Apakah tombol sudah presisi?`;
    const res = extractImageAttachments(prompt, { baseDir: tmpDir });

    assert.equal(res.images.length, 1);
    assert.equal(res.images[0].path, sampleJpg);
    assert.equal(res.cleanText, 'Apakah tombol sudah presisi?');
  });

  it('buildMultimodalContent harus mengembalikan string polos jika tidak ada gambar', () => {
    const res = buildMultimodalContent('Halo dunia');
    assert.equal(typeof res, 'string');
    assert.equal(res, 'Halo dunia');
  });

  it('buildMultimodalContent harus mengembalikan format array OpenAI jika ada gambar', () => {
    const mockImage = {
      mimeType: 'image/png',
      base64: 'abc123xyz',
    };
    const res = buildMultimodalContent('Analisis ini', [mockImage]);

    assert.ok(Array.isArray(res));
    assert.equal(res.length, 2);
    assert.deepEqual(res[0], { type: 'text', text: 'Analisis ini' });
    assert.deepEqual(res[1], {
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,abc123xyz' },
    });
  });

  it('processMultimodalPrompt harus mengintegrasikan ekstraksi dan pembentukan payload', () => {
    const prompt = `Cek layout @${samplePng}`;
    const res = processMultimodalPrompt(prompt, { baseDir: tmpDir });

    assert.equal(res.images.length, 1);
    assert.equal(res.cleanText, 'Cek layout');
    assert.ok(Array.isArray(res.content));
    assert.equal(res.content[0].text, 'Cek layout');
    assert.equal(res.content[1].type, 'image_url');
  });
});
