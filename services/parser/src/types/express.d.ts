import type { Multer } from 'multer';

declare global {
  namespace Express {
    interface Request {
      file?: Multer.File;
    }
  }
}

export {};
