/**
 * zip-writer.mjs — Minimal streaming ZIP file writer (store-only, no compression).
 */

import { once } from "node:events";
import { createWriteStream } from "node:fs";

import { createHttpError } from "./http-utils.mjs";

const crc32Table = buildCrc32Table();

/**
 * Create a streaming ZIP writer that appends entries to `filePath`.
 *
 * @param {string} filePath          Destination file path.
 * @param {object} [options]
 * @param {number} [options.maxEntryCount]  Maximum number of entries (default 0xFFFF).
 * @param {number} [options.maxFileBytes]   Maximum archive size in bytes (default 0xFFFFFFFF).
 */
export function createZipFileWriter(filePath, options = {}) {
  const maxEntryCount = options.maxEntryCount ?? 0xffff;
  const maxFileBytes = options.maxFileBytes ?? 0xffffffff;
  const output = createWriteStream(filePath);
  const records = [];
  let currentOffset = 0;
  let isClosed = false;

  output.on("error", () => {
    isClosed = true;
  });

  return {
    async addFile(fileName, fileBuffer) {
      if (isClosed) {
        throw createHttpError(500, "The QR archive writer is no longer available.");
      }

      if (!Buffer.isBuffer(fileBuffer)) {
        throw createHttpError(500, "QR archive entries must be written as binary buffers.");
      }

      const normalizedFileName = fileName.replace(/\\/g, "/");
      const fileNameBuffer = Buffer.from(normalizedFileName, "utf8");
      const { dosDate, dosTime } = getDosDateTimeParts(new Date());
      const headerOffset = currentOffset;
      const header = Buffer.alloc(30);
      const checksum = crc32(fileBuffer);

      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(0, 6);
      header.writeUInt16LE(0, 8);
      header.writeUInt16LE(dosTime, 10);
      header.writeUInt16LE(dosDate, 12);
      header.writeUInt32LE(checksum >>> 0, 14);
      header.writeUInt32LE(fileBuffer.length >>> 0, 18);
      header.writeUInt32LE(fileBuffer.length >>> 0, 22);
      header.writeUInt16LE(fileNameBuffer.length, 26);
      header.writeUInt16LE(0, 28);

      await writeStreamBuffer(output, header);
      await writeStreamBuffer(output, fileNameBuffer);
      await writeStreamBuffer(output, fileBuffer);
      currentOffset += header.length + fileNameBuffer.length + fileBuffer.length;

      if (currentOffset > maxFileBytes) {
        throw createHttpError(413, "The QR archive ZIP is too large to package as a single file.");
      }

      records.push({
        checksum,
        compressedSize: fileBuffer.length,
        dosDate,
        dosTime,
        fileName: normalizedFileName,
        fileNameBuffer,
        headerOffset,
        uncompressedSize: fileBuffer.length
      });
    },
    async close() {
      if (isClosed) {
        return;
      }

      const centralDirectoryOffset = currentOffset;
      let centralDirectorySize = 0;

      for (const record of records) {
        const centralHeader = Buffer.alloc(46);

        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0, 8);
        centralHeader.writeUInt16LE(0, 10);
        centralHeader.writeUInt16LE(record.dosTime, 12);
        centralHeader.writeUInt16LE(record.dosDate, 14);
        centralHeader.writeUInt32LE(record.checksum >>> 0, 16);
        centralHeader.writeUInt32LE(record.compressedSize >>> 0, 20);
        centralHeader.writeUInt32LE(record.uncompressedSize >>> 0, 24);
        centralHeader.writeUInt16LE(record.fileNameBuffer.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(record.headerOffset >>> 0, 42);

        await writeStreamBuffer(output, centralHeader);
        await writeStreamBuffer(output, record.fileNameBuffer);
        currentOffset += centralHeader.length + record.fileNameBuffer.length;
        centralDirectorySize += centralHeader.length + record.fileNameBuffer.length;
      }

      if (records.length > maxEntryCount || currentOffset > maxFileBytes) {
        throw createHttpError(413, "The QR archive ZIP is too large to package as a single file.");
      }

      const endOfCentralDirectory = Buffer.alloc(22);
      endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
      endOfCentralDirectory.writeUInt16LE(0, 4);
      endOfCentralDirectory.writeUInt16LE(0, 6);
      endOfCentralDirectory.writeUInt16LE(records.length, 8);
      endOfCentralDirectory.writeUInt16LE(records.length, 10);
      endOfCentralDirectory.writeUInt32LE(centralDirectorySize >>> 0, 12);
      endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset >>> 0, 16);
      endOfCentralDirectory.writeUInt16LE(0, 20);

      await writeStreamBuffer(output, endOfCentralDirectory);
      output.end();
      await once(output, "finish");
      isClosed = true;
    },
    async abort() {
      if (isClosed) {
        return;
      }

      output.destroy();
      try {
        await once(output, "close");
      } catch {
        // Ignore close races during abort cleanup.
      }
      isClosed = true;
    }
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function writeStreamBuffer(stream, buffer) {
  if (stream.write(buffer)) {
    return;
  }

  await once(stream, "drain");
}

function getDosDateTimeParts(date) {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  return {
    dosDate: ((year - 1980) << 9) | (month << 5) | day,
    dosTime: (hours << 11) | (minutes << 5) | seconds
  };
}

function crc32(buffer) {
  let checksum = 0xffffffff;

  for (const value of buffer) {
    checksum = (checksum >>> 8) ^ crc32Table[(checksum ^ value) & 0xff];
  }

  return (checksum ^ 0xffffffff) >>> 0;
}

function buildCrc32Table() {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1
        ? 0xedb88320 ^ (value >>> 1)
        : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
}
