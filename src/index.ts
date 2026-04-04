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

    // Bot orqali xabar yuborish
    const BOT_TOKEN = process.env.BOT_TOKEN;
    if (BOT_TOKEN) {
      const message = `✅ <b>Yangi test yaratildi!</b>\n\n📋 Test kodi: <b>${newTestCode}</b>\n👤 Yaratuvchi: ${user?.name || 'Noma\'lum'}\n\nBoshqalar ham shu kod orqali testni ishlashi mumkin.`;
      try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: parseInt(telegramId),
            text: message,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[
                { text: '📱 Test ishlash', web_app: { url: process.env.FRONTEND_URL || 'https://frontend-eta-one-72.vercel.app' } }
              ]]
            }
          })
        });
      } catch (err) {
        console.error('Bot xabar yuborish xatosi:', err);
      }
    }

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

// ✅ Test natijasini saqlash (Milliy Sertifikat formatida)
app.post('/api/tests/:testCode/submit', verifyTelegramInitData, async (req, res) => {
  try {
    const telegramId = (req as any).telegramData.user.id.toString();
    const testCode = parseInt(req.params.testCode);
    const { answers } = req.body;

    const test = await prisma.test.findUnique({ where: { testCode } });
    if (!test) return res.status(404).json({ error: 'Test topilmadi' });

    // Milliy Sertifikat baholash modeli
    // 1-32: A/B/C/D — har biri 1.0 ball
    // 33-35: A-F — har biri 2.0 ball
    // 36-45: 2 qismli — har bir qism 2.5 ball (jami 20 ta qism)
    // Maksimal xom ball: 88.0
    
    const answerKeys = test.answerKeys as Record<string, string>;
    let correctCount = 0;
    let rawScore = 0;

    for (const [key, value] of Object.entries(answers as Record<string, string>)) {
      const isCorrect = answerKeys[key] && answerKeys[key].toUpperCase() === value.toUpperCase();
      if (isCorrect) {
        correctCount++;
        
        // Vaznli ball hisoblash
        const num = parseInt(key.split('.')[0]);
        if (num >= 1 && num <= 32) {
          rawScore += 1.0;
        } else if (num >= 33 && num <= 35) {
          rawScore += 2.0;
        } else if (num >= 36 && num <= 45) {
          rawScore += 2.5;
        }
      }
    }

    // Standart ball (0-100)
    const scaledScore = Math.round((rawScore / 88.0) * 100 * 100) / 100;
    // Foiz
    const percentage = Math.round((correctCount / 45) * 100 * 10) / 10;
    
    // Harfli daraja
    let grade = 'F';
    let isCertified = false;
    if (scaledScore >= 90) { grade = 'A+'; isCertified = true; }
    else if (scaledScore >= 80) { grade = 'A'; isCertified = true; }
    else if (scaledScore >= 70) { grade = 'B+'; isCertified = true; }
    else if (scaledScore >= 60) { grade = 'B'; isCertified = true; }
    else if (scaledScore >= 50) { grade = 'C+'; }
    else if (scaledScore >= 40) { grade = 'C'; }
    else { grade = 'F'; }

    const result = await prisma.testResult.create({
      data: {
        telegramId,
        testCode,
        answers,
        score: correctCount,
        total: 45,
        rawScore,
        scaledScore,
        percentage,
        grade,
        isCertified,
      }
    });

    res.json({ 
      success: true, 
      score: correctCount, 
      total: 45,
      rawScore: Math.round(rawScore * 100) / 100,
      scaledScore,
      percentage,
      grade,
      isCertified,
    });
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

// ✅ Admin: Statistika
app.get('/api/admin/stats', async (req, res) => {
  try {
    const totalUsers = await prisma.user.count();
    const totalTests = await prisma.test.count();
    res.json({ totalUsers, totalTests });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ✅ Admin: Reklama yuborish (barcha userlarga)
app.post('/api/admin/broadcast', async (req, res) => {
  try {
    const { message, adminId } = req.body;
    const BOT_TOKEN = process.env.BOT_TOKEN;
    
    if (!BOT_TOKEN) {
      return res.status(400).json({ error: 'BOT_TOKEN not configured' });
    }

    // Barcha userlarni olish
    const users = await prisma.user.findMany({
      select: { telegramId: true }
    });

    let sent = 0;
    for (const user of users) {
      try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: parseInt(user.telegramId),
            text: message,
            parse_mode: 'HTML'
          })
        });
        sent++;
        // Rate limiting - har bir xabar orasida 50ms kutish
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch {
        // User botni bloklagan yoki boshqa xato
      }
    }

    res.json({ success: true, sent });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
