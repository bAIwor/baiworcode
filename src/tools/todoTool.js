/**
 * Tool `todo_list` untuk bAIwor Code.
 *
 * Port ringkas dari pola `todo_tool` pada agen CLI modern. Dipakai agar bAIwor
 * dapat menyusun rencana tugas saat mengerjakan fitur besar, sehingga pengguna
 * pemula bisa melihat progres langkah demi langkah.
 *
 * Perilaku:
 *   - Panggil tanpa `todos` -> membaca daftar saat ini.
 *   - Kirim `todos`        -> mengganti seluruh daftar (default) atau merge by id.
 *   - Urutan daftar = prioritas. Hanya SATU item boleh `in_progress`.
 *   - Setiap penulisan menaikkan `revision` agar klien bisa menolak update basi.
 */

export const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];
export const MAX_TODO_ITEMS = 256;
export const MAX_TODO_CONTENT_CHARS = 4000;

const TRUNCATION_MARKER = '… [dipotong]';

function capContent(content) {
  if (content.length > MAX_TODO_CONTENT_CHARS) {
    return content.slice(0, MAX_TODO_CONTENT_CHARS - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
  }
  return content;
}

/**
 * Menyimpan satu daftar tugas dalam memori (satu per proses).
 */
export class TodoStore {
  constructor() {
    this.items = [];
    this.revision = 0;
  }

  read() {
    return this.items.map((item) => ({ ...item }));
  }

  hasItems() {
    return this.items.length > 0;
  }

  snapshot() {
    return { todos: this.read(), revision: this.revision };
  }

  /**
   * Mengosongkan seluruh daftar tugas.
   *
   * @returns {boolean} true bila memang ada item yang dihapus.
   */
  clear() {
    if (this.items.length === 0) return false;
    this.items = [];
    this.revision += 1;
    return true;
  }

  /**
   * Menghapus daftar HANYA bila semua itemnya sudah "settled" — yakni
   * `completed` atau `cancelled`. Dipanggil di awal giliran baru supaya daftar
   * yang sudah tuntas tidak terus menggantung di widget (gejala "0/3" nyangkut).
   * Adaptasi perilaku `clearSettled` dari MiniMax Code.
   *
   * @returns {boolean} true bila daftar dibersihkan.
   */
  clearSettled() {
    if (this.items.length === 0) return false;
    const allSettled = this.items.every(
      (item) => item.status === 'completed' || item.status === 'cancelled'
    );
    return allSettled ? this.clear() : false;
  }

  /**
   * Menulis daftar tugas. Bila validasi gagal, daftar lama TIDAK berubah.
   */
  write(todos, merge = false) {
    const before = this.read();

    if (merge) {
      this.#merge(todos);
    } else {
      this.items = this.#normalizeOrder(todos.map((t) => TodoStore.validate(t)));
    }

    this.items = this.items.slice(0, MAX_TODO_ITEMS);
    TodoStore.#sanitizeParents(this.items);
    TodoStore.#enforceSingleActive(this.items);

    if (JSON.stringify(this.items) !== JSON.stringify(before)) {
      this.revision += 1;
    }
    return this.read();
  }

  #merge(todos) {
    // Bekerja pada salinan: bila salah satu item baru tidak valid, daftar lama
    // tidak boleh berubah sama sekali (validasi gagal = rollback penuh).
    const nextItems = this.items.map((item) => ({ ...item }));
    const existing = new Map(nextItems.map((item) => [item.id, item]));
    const order = nextItems.map((item) => item.id);

    for (const raw of TodoStore.#dedupeById(todos)) {
      const id = String(raw?.id ?? '').trim();
      if (!id) continue; // tidak bisa merge tanpa id

      const current = existing.get(id);
      if (!current) {
        const validated = TodoStore.validate(raw);
        existing.set(validated.id, validated);
        order.push(validated.id);
        continue;
      }

      if (raw.content) current.content = capContent(String(raw.content).trim());
      const status = String(raw.status ?? '').trim().toLowerCase();
      if (VALID_STATUSES.includes(status)) current.status = status;
      if ('parent' in raw) {
        const parent = String(raw.parent ?? '').trim();
        if (parent) current.parent = parent;
        else delete current.parent;
      }
    }

    this.items = this.#normalizeOrder(order.map((id) => existing.get(id)).filter(Boolean));
  }

  #normalizeOrder(items) {
    const statuses = items.map((item) => item.status);
    if (items.some((item) => item.parent)) return items; // daftar bersarang: jaga urutan asli
    const activeIdx = statuses.indexOf('in_progress');
    if (activeIdx < 0) return items;
    if (!statuses.slice(0, activeIdx).includes('pending')) return items;
    const out = items.slice();
    const [active] = out.splice(activeIdx, 1);
    out.splice(statuses.indexOf('pending'), 0, active);
    return out;
  }

  static validate(item) {
    if (!item || typeof item !== 'object') {
      throw new Error('Setiap item todo harus berupa object { id, content, status }.');
    }
    const id = String(item.id ?? '').trim() || '?';
    const content = String(item.content ?? '').trim();
    if (!content) {
      throw new Error(`Item todo '${id}' tidak memiliki "content". Setiap item wajib punya deskripsi.`);
    }
    const status = String(item.status ?? 'pending').trim().toLowerCase();
    const result = {
      id,
      content: capContent(content),
      status: VALID_STATUSES.includes(status) ? status : 'pending',
    };
    const parent = String(item.parent ?? '').trim();
    if (parent && parent !== id) result.parent = parent;
    return result;
  }

  static #dedupeById(todos) {
    const lastIndex = new Map();
    todos.forEach((item, index) => {
      const key = item && typeof item === 'object' ? String(item.id ?? '').trim() || '?' : `__invalid_${index}`;
      lastIndex.set(key, index);
    });
    return [...lastIndex.values()].sort((a, b) => a - b).map((i) => todos[i]);
  }

  static #sanitizeParents(items) {
    const byId = new Map(items.map((item) => [item.id, item]));
    for (const item of items) {
      if (item.parent && !byId.has(item.parent)) delete item.parent;
    }
    for (const item of items) {
      const seen = new Set([item.id]);
      let node = item;
      while (node.parent) {
        if (seen.has(node.parent)) {
          delete item.parent;
          break;
        }
        seen.add(node.parent);
        node = byId.get(node.parent);
      }
    }
  }

  static #enforceSingleActive(items) {
    let seenActive = false;
    for (const item of items) {
      if (item.status === 'in_progress') {
        if (!seenActive) {
          seenActive = true;
        } else {
          item.status = 'pending';
        }
      }
    }
  }
}

/** Daftar tugas milik sesi CLI aktif. */
export const todoStore = new TodoStore();

/** Mengosongkan daftar (dipakai pengujian dan `/reset`). */
export function resetTodoStore() {
  todoStore.items = [];
  todoStore.revision = 0;
}

function summarize(items) {
  const summary = { total: items.length };
  for (const status of VALID_STATUSES) {
    summary[status] = items.filter((item) => item.status === status).length;
  }
  return summary;
}

/**
 * Handler tool `todo_list`.
 *
 * @param {Object} args
 * @param {Array} [args.todos] - Item tugas yang ditulis. Kosongkan untuk membaca.
 * @param {boolean} [args.merge=false] - true: update by id; false: ganti seluruh daftar.
 * @returns {Promise<{success: boolean, output: string}>}
 */
export async function handleTodoList({ todos, merge = false } = {}) {
  if (todos === undefined || todos === null) {
    const items = todoStore.read();
    return {
      success: true,
      output: JSON.stringify(
        { todos: items, revision: todoStore.revision, summary: summarize(items) },
        null,
        2
      ),
    };
  }

  if (!Array.isArray(todos)) {
    return { success: false, output: `Error: "todos" harus berupa array, diterima ${typeof todos}.` };
  }

  try {
    const items = todoStore.write(todos, Boolean(merge));
    return {
      success: true,
      output: JSON.stringify(
        { todos: items, revision: todoStore.revision, summary: summarize(items) },
        null,
        2
      ),
    };
  } catch (err) {
    return { success: false, output: `Error: ${err.message}` };
  }
}
