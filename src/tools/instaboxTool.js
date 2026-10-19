/**
 * Tool eksekusi Cloud Sandbox InstaBox untuk bAIwor Code.
 *
 * Memanfaatkan @insforge/instabox-sdk untuk menjalankan perintah komputasi berat,
 * pengujian unit besar, atau task berisiko di dalam MicroVM Linux 4 vCPU / 8 GiB RAM
 * tanpa membebani komputer lokal pengguna.
 */

import { Sandbox } from '@insforge/instabox-sdk';
import { getInstaboxApiKey, getInstaboxMachineId } from '../config.js';
import { USER_AGENT } from '../branding.js';

export const INSTABOX_API_ENDPOINT = 'https://api.instabox.sh';

/**
 * Mengeksekusi perintah shell di dalam sandbox InstaBox.
 *
 * @param {Object} args
 * @param {string} args.command - Perintah shell Linux yang akan dieksekusi
 * @param {string} [args.machine_id] - ID atau nama mesin InstaBox target
 * @param {number} [args.timeout_ms=60000] - Batas waktu eksekusi dalam milidetik
 * @returns {Promise<{ success: boolean, output: string }>}
 */
export async function handleInstaboxExec({ command, machine_id, timeout_ms = 60000 } = {}) {
  const apiKey = getInstaboxApiKey();
  if (!apiKey) {
    return {
      success: false,
      output: 'Error: API Key InstaBox belum dikonfigurasi. Atur via /sandbox key <api_key> atau di ~/.baiwor/config.json',
    };
  }

  const cmd = String(command || '').trim();
  if (!cmd) {
    return { success: false, output: 'Error: Parameter command tidak boleh kosong.' };
  }

  const machine = machine_id || getInstaboxMachineId() || 'baiwor';

  try {
    const box = await Sandbox.connect(machine, {
      apiKey,
      apiUrl: INSTABOX_API_ENDPOINT,
      fetch: (url, init) => {
        const headers = new Headers(init?.headers || {});
        headers.set('User-Agent', USER_AGENT);
        return globalThis.fetch(url, { ...init, headers });
      },
    });

    const res = await box.commands.run(cmd, {
      timeoutMs: timeout_ms,
    });

    const out = (res.stdout || '').trim();
    const err = (res.stderr || '').trim();
    const code = typeof res.exitCode === 'number' ? res.exitCode : 0;

    let fullOutput = out;
    if (err) {
      fullOutput = fullOutput ? `${fullOutput}\n[stderr]\n${err}` : `[stderr]\n${err}`;
    }
    if (!fullOutput) {
      fullOutput = '(Perintah selesai tanpa output di sandbox InstaBox)';
    }

    return {
      success: code === 0,
      output: `[InstaBox: ${machine}] (Exit Code: ${code})\n${fullOutput}`,
    };
  } catch (err) {
    return {
      success: false,
      output: `Gagal mengeksekusi di InstaBox (${machine}): ${err.message}`,
    };
  }
}

/**
 * Mengambil status kesehatan dan spesifikasi mesin InstaBox.
 *
 * @param {string} [machineId]
 * @returns {Promise<Object>}
 */
export async function getInstaboxStatus(machineId) {
  const apiKey = getInstaboxApiKey();
  if (!apiKey) {
    return { configured: false, message: 'API Key InstaBox belum dikonfigurasi.' };
  }

  const machine = machineId || getInstaboxMachineId() || 'baiwor';

  try {
    const res = await globalThis.fetch(`${INSTABOX_API_ENDPOINT}/v1/machines/${machine}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': USER_AGENT,
      },
    });

    if (!res.ok) {
      return {
        configured: true,
        ok: false,
        status: res.status,
        message: `HTTP ${res.status}: ${res.statusText}`,
      };
    }

    const data = await res.json();
    return {
      configured: true,
      ok: true,
      machine: data,
    };
  } catch (err) {
    return { configured: true, ok: false, message: err.message };
  }
}

/**
 * Mengontrol siklus hidup mesin InstaBox (pause / resume / stop).
 *
 * @param {'pause'|'resume'|'stop'} action
 * @param {string} [machineId]
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function controlInstabox(action = 'pause', machineId) {
  const apiKey = getInstaboxApiKey();
  if (!apiKey) {
    return { success: false, message: 'API Key InstaBox belum dikonfigurasi.' };
  }

  const machine = machineId || getInstaboxMachineId() || 'baiwor';

  try {
    const box = await Sandbox.connect(machine, {
      apiKey,
      apiUrl: INSTABOX_API_ENDPOINT,
      fetch: (url, init) => {
        const headers = new Headers(init?.headers || {});
        headers.set('User-Agent', USER_AGENT);
        return globalThis.fetch(url, { ...init, headers });
      },
    });

    if (action === 'pause') {
      await box.pause();
      return { success: true, message: `Mesin InstaBox [${machine}] berhasil dibekukan (paused).` };
    } else if (action === 'resume') {
      await box.resume();
      return { success: true, message: `Mesin InstaBox [${machine}] berhasil diaktifkan kembali (running).` };
    } else if (action === 'stop') {
      await box.stop();
      return { success: true, message: `Mesin InstaBox [${machine}] berhasil dihentikan (stopped).` };
    }

    return { success: false, message: `Aksi tidak dikenal: ${action}` };
  } catch (err) {
    return { success: false, message: `Gagal mengontrol mesin [${machine}]: ${err.message}` };
  }
}

/**
 * Membuka URL tertentu di peramban GUI desktop cloud InstaBox.
 *
 * @param {string} url
 * @param {string} [machineId]
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function openInstaboxDesktop(url, machineId) {
  const apiKey = getInstaboxApiKey();
  if (!apiKey) {
    return { success: false, message: 'API Key InstaBox belum dikonfigurasi.' };
  }

  const cleanUrl = String(url || '').trim();
  if (!cleanUrl) {
    return { success: false, message: 'Parameter URL tidak boleh kosong.' };
  }

  const targetUrl = /^https?:\/\//i.test(cleanUrl) ? cleanUrl : `https://${cleanUrl}`;
  const machine = machineId || getInstaboxMachineId() || 'baiwor';

  try {
    const box = await Sandbox.connect(machine, {
      apiKey,
      apiUrl: INSTABOX_API_ENDPOINT,
      fetch: (u, init) => {
        const headers = new Headers(init?.headers || {});
        headers.set('User-Agent', USER_AGENT);
        return globalThis.fetch(u, { ...init, headers });
      },
    });

    await box.desktop.open(targetUrl);
    return {
      success: true,
      message: `Berhasil membuka ${targetUrl} di layar GUI desktop InstaBox [${machine}].`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Gagal membuka URL di desktop InstaBox (${machine}): ${err.message}`,
    };
  }
}

/**
 * Mengambil tangkapan layar (screenshot) dari layar desktop GUI InstaBox.
 *
 * @param {string} [machineId]
 * @returns {Promise<{ success: boolean, buffer?: Uint8Array, message?: string }>}
 */
export async function captureInstaboxScreenshot(machineId) {
  const apiKey = getInstaboxApiKey();
  if (!apiKey) {
    return { success: false, message: 'API Key InstaBox belum dikonfigurasi.' };
  }

  const machine = machineId || getInstaboxMachineId() || 'baiwor';

  try {
    const box = await Sandbox.connect(machine, {
      apiKey,
      apiUrl: INSTABOX_API_ENDPOINT,
      fetch: (u, init) => {
        const headers = new Headers(init?.headers || {});
        headers.set('User-Agent', USER_AGENT);
        return globalThis.fetch(u, { ...init, headers });
      },
    });

    const buffer = await box.desktop.screenshot();
    return {
      success: true,
      buffer,
      message: `Berhasil mengambil screenshot GUI desktop InstaBox [${machine}].`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Gagal mengambil screenshot desktop InstaBox (${machine}): ${err.message}`,
    };
  }
}

