import { Database } from "bun:sqlite";
import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statfsSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export type DatabasePaths = {
  root: string;
  configPath: string;
  dataDir: string;
  databasePath: string;
  viewsDir: string;
  backupsDir: string;
};
export type DatabaseEvidence = {
  version: string;
  source: string;
  filesystem: number;
  journal: string;
};
const localFilesystems = new Set([
  0x1a, 0x11, 0xef53, 0x01021994, 0x794c7630, 0x9123683e, 0x58465342,
]);
export function assertPatchedSQLite(version: string, source: string): void {
  const [major, minor, patch] = version.split(".").map(Number);
  const patched =
    major === 3 &&
    (minor! > 51 ||
      (minor === 51 && patch! >= 3) ||
      (minor === 50 && patch! >= 7) ||
      (minor === 44 && patch! >= 6));
  if (
    !patched ||
    !/^\d{4}-\d{2}-\d{2} .* [a-f0-9]{40,}(?:alt\d|aapl)?$/.test(source)
  )
    throw new Error("SQLITE_BUILD_UNVERIFIED: patched WAL build required");
}
export function assertPrivateDatabasePath(path: string, root: string): void {
  if (!isAbsolute(path) || !isAbsolute(root))
    throw new Error("INSTANCE_PATH_INVALID");
  const rel = relative(resolve(root), resolve(path));
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel))
    throw new Error("INSTANCE_PATH_ESCAPE");
  let cursor = resolve(path);
  while (cursor !== dirname(cursor)) {
    try {
      if (lstatSync(cursor).isSymbolicLink())
        throw new Error("INSTANCE_SYMLINK_REJECTED");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (cursor === resolve(root)) break;
    cursor = dirname(cursor);
  }
  if (realpathSync(root) !== resolve(root))
    throw new Error("INSTANCE_ROOT_NOT_CANONICAL");
}
export function openDatabase(
  paths: DatabasePaths,
  create = false,
  readonly = false,
  options: { verifyIntegrity?: boolean } = {},
): { db: Database; installationId: string; evidence: DatabaseEvidence } {
  assertPrivateDatabasePath(paths.configPath, paths.root);
  assertPrivateDatabasePath(paths.databasePath, paths.root);
  for (const directory of [paths.root, paths.dataDir]) {
    const st = lstatSync(directory);
    if (!st.isDirectory() || (st.mode & 0o077) !== 0)
      throw new Error("PRIVATE_DIRECTORY_PERMISSIONS");
  }
  const configStat = lstatSync(paths.configPath);
  if (!configStat.isFile() || (configStat.mode & 0o077) !== 0)
    throw new Error("PRIVATE_FILE_PERMISSIONS");
  const config = JSON.parse(readFileSync(paths.configPath, "utf8"));
  if (
    !config ||
    typeof config.installationId !== "string" ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(config.installationId)
  )
    throw new Error("INSTANCE_ID_REQUIRED");
  if (!existsSync(paths.databasePath) && !create)
    throw new Error("STORE_NOT_INITIALIZED");
  const filesystem = Number(statfsSync(paths.dataDir).type) >>> 0;
  if (!localFilesystems.has(filesystem))
    throw new Error("SQLITE_LOCAL_FILESYSTEM_UNVERIFIED");
  if (!existsSync(paths.databasePath)) {
    if (readonly) throw new Error("STORE_NOT_INITIALIZED");
    closeSync(
      openSync(
        paths.databasePath,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      ),
    );
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = paths.databasePath + suffix;
    try {
      const st = lstatSync(file);
      if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077) !== 0)
        throw new Error("PRIVATE_FILE_PERMISSIONS");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const db = new Database(paths.databasePath, {
    create: false,
    readonly,
    strict: true,
  });
  try {
    const evidence = db
      .query("SELECT sqlite_version() AS version, sqlite_source_id() AS source")
      .get() as { version: string; source: string };
    assertPatchedSQLite(evidence.version, evidence.source);
    db.exec("PRAGMA busy_timeout=2000; PRAGMA foreign_keys=ON;");
    if (!readonly) db.exec("PRAGMA synchronous=FULL;");
    const version = (
      db.query("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    if (version !== 1) {
      if (version !== 0 || !create || readonly)
        throw new Error("STORE_SCHEMA_UNSUPPORTED");
      const tables = db
        .query("SELECT name FROM sqlite_master WHERE type='table'")
        .all();
      if (tables.length) throw new Error("STORE_UNVERSIONED_NONEMPTY");
      // Initialize WAL before the first schema write so read-only tools can use its sidecars.
      if (
        (db.query("PRAGMA journal_mode=WAL").get() as { journal_mode: string })
          .journal_mode !== "wal"
      )
        throw new Error("STORE_WAL_REQUIRED");
      db.transaction(() => {
        db.exec(
          readFileSync(
            new URL("./migrations/001-inbox-outbox.sql", import.meta.url),
            "utf8",
          ),
        );
        db.query("INSERT INTO instance VALUES(1,?,1)").run(
          config.installationId,
        );
        db.exec("PRAGMA user_version=1");
      }).immediate();
    }
    const identity = db
      .query("SELECT installation_id FROM instance WHERE singleton=1")
      .get() as { installation_id: string } | null;
    if (identity?.installation_id !== config.installationId)
      throw new Error("INSTANCE_ID_MISMATCH");
    if (
      options.verifyIntegrity === true &&
      (db.query("PRAGMA quick_check").get() as { quick_check: string })
        .quick_check !== "ok"
    )
      throw new Error("STORE_INTEGRITY_FAILED");
    const journal = (
      db
        .query(
          readonly || !create
            ? "PRAGMA journal_mode"
            : "PRAGMA journal_mode=WAL",
        )
        .get() as { journal_mode: string }
    ).journal_mode;
    if (journal !== "wal") throw new Error("STORE_WAL_REQUIRED");
    return {
      db,
      installationId: config.installationId,
      evidence: { ...evidence, filesystem, journal },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Diagnostic inspection: no mkdir, identity writes, permission repair or journal changes. */
export function inspectDatabase(paths: DatabasePaths) {
  const opened = openDatabase(paths, false, true, { verifyIntegrity: true });
  try {
    return {
      installationId: opened.installationId,
      version: opened.evidence.version,
      sourceId: opened.evidence.source,
      journalMode: opened.evidence.journal,
      filesystemVerified: true,
    };
  } finally {
    opened.db.close();
  }
}
