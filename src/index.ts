import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { verifyTelegramInitData } from './middleware/telegramAuth.js';
import dotenv from 'dotenv';

dotenv.config();
export const prisma = new PrismaClient();
const app = express();

// ✅ CORS — barcha origin'larga ruxsat
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-tg-auth', 'Authorization'],
}));

// ✅ OPTIONS preflight request'larni qabul qilish
app.options('*', cors());

app.use(express.json());

// ✅ Ro'yxatdan o'tish
app.post('/api/auth/register', verifyTelegramInitData, async (req, res) => {
  try {
    const { name, surname, phone, region, district } = req.body;
    const telegramId = (req as any).telegramData.user.id.toString();

    const user = await prisma.user.upsert({
      where: { telegramId },
      update: { name, surname, phone, region, district },
      create: { telegramId, name, surname, phone, region, district },
    });
    res.json({ success: true, user });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ✅ Foydalanuvchi ma'lumotlarini olish
app.get('/api/me', verifyTelegramInitData, async (req, res) => {
  try {
    const telegramId = (req as any).telegramData.user.id.toString();
    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) return res.status(404).json({ error: 'User topilmadi' });
    res.json(user);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ✅ User ro'yxatdan o'tganini tekshirish (bot uchun)
app.get('/api/check-user/:telegramId', async (req, res) => {
  try {
    const telegramId = req.params.telegramId;
    const user = await prisma.user.findUnique({ where: { telegramId } });
    res.json({ registered: !!user });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ✅ Test yaratish
app.post('/api/tests/create', verifyTelegramInitData, async (req, res) => {
  try {
    const telegramId = (req as any).telegramData.user.id.toString();
    const { answerKeys } = req.body;

    if (!answerKeys || typeof answerKeys !== 'object') {
      return res.status(400).json({ error: 'Javob kalitlari kiritilmagan' });
    }

    // Eng oxirgi test kodini olish
    const lastTest = await prisma.test.findFirst({
      orderBy: { testCode: 'desc' }
    });
    const newTestCode = (lastTest?.testCode || 0) + 1;

    const user = await prisma.user.findUnique({ where: { telegramId } });

    const test = await prisma.test.create({
      data: {
        testCode: newTestCode,
        title: `Test #${newTestCode}`,
        telegramId,
        answerKeys,
      }
    });

    res.json({ success: true, testCode: newTestCode, authorName: user?.name });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ✅ Test kodini tekshirish
app.get('/api/tests/:testCode', async (req, res) => {
  try {
    const testCode = parseInt(req.params.testCode);
    const test = await prisma.test.findUnique({ where: { testCode } });
    if (!test) return res.status(404).json({ error: 'Test topilmadi' });
    res.json({ success: true, test });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ✅ Test natijasini saqlash
app.post('/api/tests/:testCode/submit', verifyTelegramInitData, async (req, res) => {
  try {
    const telegramId = (req as any).telegramData.user.id.toString();
    const testCode = parseInt(req.params.testCode);
    const { answers } = req.body;

    const test = await prisma.test.findUnique({ where: { testCode } });
    if (!test) return res.status(404).json({ error: 'Test topilmadi' });

    // Ball hisoblash
    let score = 0;
    const answerKeys = test.answerKeys as Record<string, string>;
    
    for (const [key, value] of Object.entries(answers as Record<string, string>)) {
      if (answerKeys[key] && answerKeys[key].toUpperCase() === value.toUpperCase()) {
        score += 1;
      }
    }

    const total = Object.keys(answerKeys).length;

    const result = await prisma.testResult.create({
      data: {
        telegramId,
        testCode,
        answers,
        score,
        total,
      }
    });

    res.json({ success: true, score, total });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ✅ Foydalanuvchi natijalari
app.get('/api/results', verifyTelegramInitData, async (req, res) => {
  try {
    const telegramId = (req as any).telegramData.user.id.toString();
    const results = await prisma.testResult.findMany({
      where: { telegramId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    res.json(results);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
