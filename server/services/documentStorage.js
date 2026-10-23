const fs = require('fs/promises');
const path = require('path');

const DEFAULT_MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;
const MAX_ALLOWED_DOCUMENT_SIZE = 25 * 1024 * 1024;
const configuredLimit = Number(process.env.MAX_DOCUMENT_SIZE_BYTES || DEFAULT_MAX_DOCUMENT_SIZE);

if (!Number.isSafeInteger(configuredLimit) || configuredLimit < 1 || configuredLimit > MAX_ALLOWED_DOCUMENT_SIZE) {
  throw new Error('MAX_DOCUMENT_SIZE_BYTES must be an integer between 1 and 26214400.');
}

const MAX_DOCUMENT_SIZE_BYTES = configuredLimit;
const STORAGE_DIRECTORY = path.resolve(
  process.env.DOCUMENT_STORAGE_DIR || path.join(__dirname, '..', 'private_uploads')
);
const PUBLIC_DIRECTORIES = [
  path.resolve(__dirname, '..', 'public'),
  path.resolve(__dirname, '..', '..', 'client', 'public'),
];
const normalizeForComparison = (value) =>
  process.platform === 'win32' ? value.toLowerCase() : value;
const isInside = (directory, candidate) => {
  const normalizedDirectory = normalizeForComparison(directory);
  const normalizedCandidate = normalizeForComparison(candidate);
  return normalizedCandidate === normalizedDirectory ||
    normalizedCandidate.startsWith(`${normalizedDirectory}${path.sep}`);
};

if (PUBLIC_DIRECTORIES.some((directory) => isInside(directory, STORAGE_DIRECTORY))) {
  throw new Error('Document storage must not be configured inside a public directory.');
}

const getStoredPath = (storedName) => {
  if (typeof storedName !== 'string' || !/^[a-f0-9-]{36}\.(pdf|docx)$/i.test(storedName)) {
    throw new Error('Invalid internal attachment storage name.');
  }
  const resolved = path.resolve(STORAGE_DIRECTORY, storedName);
  if (path.dirname(resolved) !== STORAGE_DIRECTORY) {
    throw new Error('Invalid internal attachment storage path.');
  }
  return resolved;
};

const writeStoredFile = async (storedName, buffer) => {
  await fs.mkdir(STORAGE_DIRECTORY, { recursive: true, mode: 0o700 });
  await fs.writeFile(getStoredPath(storedName), buffer, { flag: 'wx', mode: 0o600 });
};

const removeStoredFile = async (storedName) => {
  try {
    await fs.unlink(getStoredPath(storedName));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
};

module.exports = {
  MAX_DOCUMENT_SIZE_BYTES,
  STORAGE_DIRECTORY,
  getStoredPath,
  writeStoredFile,
  removeStoredFile,
};
