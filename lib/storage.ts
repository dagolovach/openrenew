import { promises as fs } from "fs";
import path from "path";

function dataDir(): string {
  return path.resolve(process.env.DATA_DIR ?? "/data/contracts");
}

/** Resolve a stored relative file_path to an absolute path, refusing traversal. */
export function pdfAbsolutePath(relPath: string): string {
  const abs = path.resolve(dataDir(), relPath);
  if (!abs.startsWith(dataDir() + path.sep)) {
    throw new Error(`Path escapes DATA_DIR: ${relPath}`);
  }
  return abs;
}

export async function savePdf(relPath: string, bytes: ArrayBuffer | Buffer): Promise<void> {
  const abs = pdfAbsolutePath(relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, Buffer.from(bytes as ArrayBuffer));
}

export async function readPdf(relPath: string): Promise<Buffer> {
  return fs.readFile(pdfAbsolutePath(relPath));
}
