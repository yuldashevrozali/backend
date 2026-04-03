import { Request, Response, NextFunction } from 'express';
import { createHmac } from 'crypto';

export const verifyTelegramInitData = (req: Request, res: Response, next: NextFunction) => {
  try {
    const initData = req.headers['x-tg-auth'] as string;
    if (!initData) return res.status(401).json({ error: 'No Telegram auth data' });

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    
    const sortedParams = Array.from(params.entries())
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n');

    const BOT_TOKEN = process.env.BOT_TOKEN;
    const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const computedHash = createHmac('sha256', secretKey).update(sortedParams).digest('hex');

    if (computedHash !== hash) {
      return res.status(403).json({ error: 'Invalid Telegram auth data' });
    }

    // initData'ni keyingi controllerlarda ishlatish uchun req ga qo'shamiz
    (req as any).telegramData = {
      user: JSON.parse(params.get('user') || '{}'),
      auth_date: params.get('auth_date'),
    };
    next();
  } catch (err) {
    res.status(400).json({ error: 'Auth verification failed' });
  }
};