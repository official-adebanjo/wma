import * as fs from 'fs';
import * as path from 'path';
import { testFiles } from './factories';

const root = path.resolve(__dirname, '../..');

/** Minimal valid PDF bytes. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
/** 1x1 JPEG. */
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');

/** Creates the upload fixtures (incl. an 11MB file to exercise the 10MB EvidencePanel limit). Idempotent. */
export function ensureTestFiles(): typeof testFiles {
  const write = (rel: string, data: Buffer | (() => Buffer)) => {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) return;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof data === 'function' ? data() : data);
  };
  write(testFiles.validPdf, PDF);
  write(testFiles.validJpg, JPG);
  write(testFiles.oversized, () => Buffer.concat([PDF, Buffer.alloc(11 * 1024 * 1024, 0x20)]));
  write(testFiles.unsupported, Buffer.from('not an allowed file type'));
  return testFiles;
}

export const abs = (rel: string) => path.join(root, rel);
