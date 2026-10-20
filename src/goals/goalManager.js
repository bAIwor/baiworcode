import fs from 'node:fs';
import path from 'node:path';

/**
 * Goal/Task Management System untuk bAIwor Code.
 *
 * Structured task tracking dengan dependencies, turn budgets, dan status management.
 * Memungkinkan pengguna mengelola proyek kompleks dengan banyak subtask dan tracking progres.
 *
 * Arsitektur:
 *   1. Goals adalah objective besar dengan optional turn budget
 *   2. Tasks adalah unit kerja individual yang bisa memiliki dependencies
 *   3. Dependencies: blocks/blockedBy untuk urutan eksekusi
 *   4. Status: pending → in_progress → completed/deleted
 *   5. Persistence: ~/.baiwor/goals.json (global) atau .baiwor/goals.json (project)
 */

/**
 * @typedef {Object} Goal
 * @property {string} id - Unique identifier
 * @property {string} objective - Deskripsi objective
 * @property {string} status - 'active' | 'completed' | 'blocked'
 * @property {number} [maxTurns] - Batas maksimal turns (optional)
 * @property {number} turnsUsed - Jumlah turns yang sudah digunakan
 * @property {string} createdAt - Timestamp pembuatan
 * @property {string} [updatedAt] - Timestamp update terakhir
 */

/**
 * @typedef {Object} Task
 * @property {string} id - Unique identifier
 * @property {string} subject - Judul task
 * @property {string} description - Deskripsi detail
 * @property {string} status - 'pending' | 'in_progress' | 'completed' | 'deleted'
 * @property {string} [owner] - Owner task (agent name)
 * @property {string[]} [blocks] - ID task yang diblokir oleh task ini
 * @property {string[]} [blockedBy] - ID task yang memblokir task ini
 * @property {string} [goalId] - ID goal yang terkait (optional)
 * @property {string} createdAt - Timestamp pembuatan
 * @property {string} [updatedAt] - Timestamp update terakhir
 */

export class GoalManager {
  /**
   * @param {{cwd?: string, storagePath?: string}} [options]
   */
  constructor(options = {}) {
    this.cwd = options.cwd || process.cwd();
    this.storagePath = options.storagePath || this.#resolveStoragePath();
    this.goals = new Map();
    this.tasks = new Map();
    this.nextGoalId = 1;
    this.nextTaskId = 1;
    this.#load();
  }

  #resolveStoragePath() {
    // Prioritas: .baiwor/goals.json (project) > ~/.baiwor/goals.json (global)
    const projectPath = path.join(this.cwd, '.baiwor', 'goals.json');
    if (fs.existsSync(projectPath)) {
      return projectPath;
    }

    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const globalPath = path.join(homeDir, '.baiwor', 'goals.json');
    return globalPath;
  }

  #load() {
    if (!fs.existsSync(this.storagePath)) {
      return;
    }

    try {
      const content = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
      if (content.goals) {
        for (const goal of content.goals) {
          this.goals.set(goal.id, goal);
        }
      }
      if (content.tasks) {
        for (const task of content.tasks) {
          this.tasks.set(task.id, task);
        }
      }
      if (content.nextGoalId) this.nextGoalId = content.nextGoalId;
      if (content.nextTaskId) this.nextTaskId = content.nextTaskId;
    } catch (err) {
      console.warn(`[Goals] Gagal memuat dari ${this.storagePath}: ${err.message}`);
    }
  }

  #save() {
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    const data = {
      goals: Array.from(this.goals.values()),
      tasks: Array.from(this.tasks.values()),
      nextGoalId: this.nextGoalId,
      nextTaskId: this.nextTaskId,
    };

    fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  // ========== GOAL OPERATIONS ==========

  /**
   * Membuat goal baru.
   *
   * @param {string} objective - Deskripsi objective
   * @param {{maxTurns?: number}} [options]
   * @returns {Goal}
   */
  createGoal(objective, options = {}) {
    const id = String(this.nextGoalId++);
    const goal = {
      id,
      objective,
      status: 'active',
      maxTurns: options.maxTurns || null,
      turnsUsed: 0,
      createdAt: new Date().toISOString(),
    };

    this.goals.set(id, goal);
    this.#save();
    return goal;
  }

  /**
   * Mendapatkan goal berdasarkan ID.
   *
   * @param {string} id
   * @returns {Goal | null}
   */
  getGoal(id) {
    return this.goals.get(id) || null;
  }

  /**
   * Mendapatkan goal aktif saat ini.
   *
   * @returns {Goal | null}
   */
  getActiveGoal() {
    for (const goal of this.goals.values()) {
      if (goal.status === 'active') return goal;
    }
    return null;
  }

  /**
   * Mengupdate status goal.
   *
   * @param {string} id
   * @param {'active' | 'completed' | 'blocked'} status
   */
  updateGoalStatus(id, status) {
    const goal = this.goals.get(id);
    if (!goal) {
      throw new Error(`Goal '${id}' tidak ditemukan`);
    }

    goal.status = status;
    goal.updatedAt = new Date().toISOString();
    this.#save();
  }

  /**
   * Menambah turn usage goal.
   *
   * @param {string} id
   * @returns {boolean} - true jika masih dalam budget, false jika melebihi
   */
  incrementGoalTurn(id) {
    const goal = this.goals.get(id);
    if (!goal) return true;

    goal.turnsUsed++;
    goal.updatedAt = new Date().toISOString();
    this.#save();

    if (goal.maxTurns && goal.turnsUsed > goal.maxTurns) {
      return false;
    }
    return true;
  }

  /**
   * Mendapatkan daftar semua goals.
   *
   * @returns {Goal[]}
   */
  listGoals() {
    return Array.from(this.goals.values());
  }

  // ========== TASK OPERATIONS ==========

  /**
   * Membuat task baru.
   *
   * @param {string} subject - Judul task
   * @param {string} description - Deskripsi detail
   * @param {{goalId?: string, owner?: string}} [options]
   * @returns {Task}
   */
  createTask(subject, description, options = {}) {
    const id = String(this.nextTaskId++);
    const task = {
      id,
      subject,
      description,
      status: 'pending',
      owner: options.owner || null,
      blocks: [],
      blockedBy: [],
      goalId: options.goalId || null,
      createdAt: new Date().toISOString(),
    };

    this.tasks.set(id, task);
    this.#save();
    return task;
  }

  /**
   * Mendapatkan task berdasarkan ID.
   *
   * @param {string} id
   * @returns {Task | null}
   */
  getTask(id) {
    return this.tasks.get(id) || null;
  }

  /**
   * Mengupdate task.
   *
   * @param {string} id
   * @param {Partial<Task>} updates
   */
  updateTask(id, updates) {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task '${id}' tidak ditemukan`);
    }

    Object.assign(task, updates, { updatedAt: new Date().toISOString() });
    this.#save();
  }

  /**
   * Menandai task sebagai completed.
   *
   * @param {string} id
   */
  completeTask(id) {
    this.updateTask(id, { status: 'completed' });
  }

  /**
   * Menandai task sebagai in_progress.
   *
   * @param {string} id
   */
  startTask(id) {
    this.updateTask(id, { status: 'in_progress' });
  }

  /**
   * Menandai task sebagai deleted.
   *
   * @param {string} id
   */
  deleteTask(id) {
    this.updateTask(id, { status: 'deleted' });
  }

  /**
   * Menambahkan dependency: task1 memblokir task2.
   *
   * @param {string} task1Id - Task yang memblokir
   * @param {string} task2Id - Task yang diblokir
   */
  addDependency(task1Id, task2Id) {
    const task1 = this.tasks.get(task1Id);
    const task2 = this.tasks.get(task2Id);

    if (!task1 || !task2) {
      throw new Error('Task tidak ditemukan');
    }

    if (!task1.blocks.includes(task2Id)) {
      task1.blocks.push(task2Id);
    }
    if (!task2.blockedBy.includes(task1Id)) {
      task2.blockedBy.push(task1Id);
    }

    this.#save();
  }

  /**
   * Mendapatkan task yang bisa dijalankan (tidak diblokir).
   *
   * @returns {Task[]}
   */
  getAvailableTasks() {
    const available = [];
    for (const task of this.tasks.values()) {
      if (task.status !== 'pending') continue;

      // Cek apakah semua blocker sudah completed
      const allBlockersCompleted = task.blockedBy.every(blockerId => {
        const blocker = this.tasks.get(blockerId);
        return !blocker || blocker.status === 'completed' || blocker.status === 'deleted';
      });

      if (allBlockersCompleted) {
        available.push(task);
      }
    }
    return available;
  }

  /**
   * Mendapatkan daftar semua tasks.
   *
   * @returns {Task[]}
   */
  listTasks() {
    return Array.from(this.tasks.values());
  }

  /**
   * Mendapatkan tasks untuk goal tertentu.
   *
   * @param {string} goalId
   * @returns {Task[]}
   */
  listTasksForGoal(goalId) {
    return Array.from(this.tasks.values()).filter(t => t.goalId === goalId);
  }

  /**
   * Reset semua goals dan tasks.
   */
  reset() {
    this.goals.clear();
    this.tasks.clear();
    this.nextGoalId = 1;
    this.nextTaskId = 1;
    this.#save();
  }
}

/**
 * Singleton instance untuk digunakan di seluruh aplikasi.
 */
export const goalManager = new GoalManager();
