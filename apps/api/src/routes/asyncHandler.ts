import type { Request, Response, NextFunction, RequestHandler } from 'express';

export function asyncHandler(fn: (req: Request, res: Response) => Promise<any>): RequestHandler {
  return (req, res, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}
