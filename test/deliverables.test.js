import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createOsc8Link,
  parseDeliverAssetsContent,
  renderDeliverableCard,
  renderDeliverAssetsIfPresent,
} from '../src/chat/deliverables.js';

describe('Deliverable Asset Renderer (<deliver-assets> & OSC 8)', () => {
  describe('createOsc8Link', () => {
    it('harus menghasilkan escape code OSC 8 yang valid untuk terminal', () => {
      const link = createOsc8Link('index.js', 'src/index.js', { useColor: true });
      assert.ok(link.includes('\x1b]8;;file:///'));
      assert.ok(link.includes('index.js'));
      assert.ok(link.includes('\x1b]8;;\x1b\\'));
    });

    it('harus menghasilkan fallback teks biasa bila useColor false', () => {
      const link = createOsc8Link('index.js', 'src/index.js', { useColor: false });
      assert.ok(!link.includes('\x1b]8;;'));
      assert.ok(link.includes('index.js (file:///'));
    });

    it('harus mempertahankan URL web (http/https)', () => {
      const link = createOsc8Link('Dokumentasi', 'https://baiwor.my.id', { useColor: false });
      assert.equal(link, 'Dokumentasi (https://baiwor.my.id)');
    });
  });

  describe('parseDeliverAssetsContent', () => {
    it('harus mengekstrak berkas, tindakan, dan detail dari teks tag', () => {
      const raw = `
- src/tools/subagentTool.js (Dibuat, 233 baris)
- README.md: diperbarui (+20 baris)
* legacy/old.js (dihapus)
`;
      const items = parseDeliverAssetsContent(raw);
      assert.equal(items.length, 3);

      assert.equal(items[0].path, 'src/tools/subagentTool.js');
      assert.equal(items[0].action, 'dibuat');

      assert.equal(items[1].path, 'README.md');
      assert.equal(items[1].action, 'diperbarui');

      assert.equal(items[2].path, 'legacy/old.js');
      assert.equal(items[2].action, 'dihapus');
    });

    it('harus mengembalikan array kosong jika input kosong', () => {
      assert.deepEqual(parseDeliverAssetsContent(''), []);
      assert.deepEqual(parseDeliverAssetsContent(null), []);
    });
  });

  describe('renderDeliverableCard & renderDeliverAssetsIfPresent', () => {
    it('harus merender kartu visual dengan judul dan border', () => {
      const items = [
        { path: 'src/app.js', action: 'dibuat', detail: '25 baris' },
        { path: 'package.json', action: 'diperbarui', detail: '+1 dep' },
      ];

      const card = renderDeliverableCard(items, { useColor: false });
      assert.ok(card.includes('BERKAS HASIL PEKERJAAN (DELIVERABLES)'));
      assert.ok(card.includes('📄'));
      assert.ok(card.includes('[Dibuat]'));
      assert.ok(card.includes('src/app.js'));
      assert.ok(card.includes('📝'));
      assert.ok(card.includes('[Diperbarui]'));
    });

    it('harus mendeteksi tag <deliver-assets> dalam teks dan merendernya', () => {
      const text = `Tugas telah selesai dilaksanakan!

<deliver-assets>
- src/chat/deliverables.js (Dibuat, 120 baris)
</deliver-assets>

Silakan periksa berkas di atas.`;

      const rendered = renderDeliverAssetsIfPresent(text, { useColor: false });
      assert.ok(!rendered.includes('<deliver-assets>'));
      assert.ok(rendered.includes('BERKAS HASIL PEKERJAAN (DELIVERABLES)'));
      assert.ok(rendered.includes('src/chat/deliverables.js'));
      assert.ok(rendered.includes('Silakan periksa berkas di atas.'));
    });

    it('harus mengembalikan teks utuh jika tidak ada tag <deliver-assets>', () => {
      const text = 'Pekerjaan selesai tanpa deliverable khusus.';
      const res = renderDeliverAssetsIfPresent(text);
      assert.equal(res, text);
    });
  });
});
