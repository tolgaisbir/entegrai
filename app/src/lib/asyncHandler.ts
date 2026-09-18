import type { NextFunction, Request, RequestHandler, Response } from "express";

// Express 4, async route handler içindeki reddedilen promise'leri otomatik
// yakalamaz (yakalanmazsa process çöker) — bu sarmalayıcı onları next(err)'e yönlendirir.
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
