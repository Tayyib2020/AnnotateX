const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

function ensureJsonFile(file, fallback) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
}

function readJsonFile(file, fallback) {
  ensureJsonFile(file, fallback);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`Unable to read ${path.basename(file)}:`, error.message);
    return fallback;
  }
}

function normalizeUsers(users) {
  return Array.isArray(users) ? users : [];
}

function normalizeMarketplace(marketplace) {
  const normalized = marketplace && typeof marketplace === "object" ? marketplace : {};
  if (!Array.isArray(normalized.tasks)) normalized.tasks = [];
  return normalized;
}

function createPool(databaseUrl) {
  if (!databaseUrl) return null;
  const isLocal = /localhost|127\.0\.0\.1/.test(databaseUrl);
  return new Pool({
    connectionString: databaseUrl,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
    max: 5,
  });
}

class Persistence {
  constructor({ dataDirectory, importLocalData = false }) {
    this.dataDirectory = path.resolve(dataDirectory);
    this.usersFile = path.join(this.dataDirectory, "users.json");
    this.marketplaceFile = path.join(this.dataDirectory, "marketplace.json");
    this.databaseUrl = String(process.env.DATABASE_URL || "").trim();
    this.pool = createPool(this.databaseUrl);
    this.importLocalData = importLocalData;
    this.state = null;
  }

  get usesDatabase() {
    return Boolean(this.pool);
  }

  async init() {
    if (!this.pool) {
      fs.mkdirSync(this.dataDirectory, { recursive: true });
      ensureJsonFile(this.usersFile, []);
      ensureJsonFile(this.marketplaceFile, { tasks: [] });
      return;
    }

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS annotatex_state (
        state_key TEXT PRIMARY KEY,
        users JSONB NOT NULL,
        marketplace JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const result = await this.pool.query(
      "SELECT users, marketplace FROM annotatex_state WHERE state_key = $1",
      ["primary"]
    );
    if (result.rows[0]) {
      this.state = {
        users: normalizeUsers(result.rows[0].users),
        marketplace: normalizeMarketplace(result.rows[0].marketplace),
      };
      return;
    }

    this.state = this.importLocalData
      ? {
          users: normalizeUsers(readJsonFile(this.usersFile, [])),
          marketplace: normalizeMarketplace(readJsonFile(this.marketplaceFile, { tasks: [] })),
        }
      : { users: [], marketplace: { tasks: [] } };
    await this.persistState();
  }

  async getUsers() {
    this.requireInitialized();
    if (this.state) return this.state.users;
    return normalizeUsers(readJsonFile(this.usersFile, []));
  }

  async saveUsers(users) {
    this.requireInitialized();
    if (this.state) {
      this.state.users = normalizeUsers(users);
      return this.persistState();
    }
    fs.writeFileSync(this.usersFile, JSON.stringify(normalizeUsers(users), null, 2));
  }

  async getMarketplace() {
    this.requireInitialized();
    if (this.state) return this.state.marketplace;
    return normalizeMarketplace(readJsonFile(this.marketplaceFile, { tasks: [] }));
  }

  async saveMarketplace(marketplace) {
    this.requireInitialized();
    const normalized = normalizeMarketplace(marketplace);
    if (this.state) {
      this.state.marketplace = normalized;
      return this.persistState();
    }
    fs.writeFileSync(this.marketplaceFile, JSON.stringify(normalized, null, 2));
  }

  async persistState() {
    await this.pool.query(
      `
        INSERT INTO annotatex_state (state_key, users, marketplace, updated_at)
        VALUES ($1, $2::jsonb, $3::jsonb, NOW())
        ON CONFLICT (state_key) DO UPDATE SET
          users = EXCLUDED.users,
          marketplace = EXCLUDED.marketplace,
          updated_at = NOW()
      `,
      ["primary", JSON.stringify(this.state.users), JSON.stringify(this.state.marketplace)]
    );
  }

  requireInitialized() {
    if (!this.state && this.usesDatabase) throw new Error("Persistence has not been initialized");
  }

  async close() {
    if (this.pool) await this.pool.end();
  }
}

function createPersistence(options) {
  return new Persistence(options);
}

module.exports = { createPersistence };
