import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { verifyTelegramInitData } from './middleware/telegramAuth.js';
import { updateTheta, calculateProbability } from './services/rasch.js';
import dotenv from 'dotenv';

dotenv.config();
export const prisma = new PrismaClient();
const app = express();

// ✅ CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-tg-auth', 'Authorization'],
}));
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

// ✅ User ro'yxatdan o'tganini tekshirish
app.get('/api/check-user/:telegramId', async (req, res) => {
  try {
    const telegramId = req.params.telegramId;
    const user = await prisma.user.findUnique({ where: { telegramId } });
    res.json({ registered: !!user });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ✅ Test yaratish (RASCH model - savollar alohida saqlanadi)
app.post('/api/tests/create', verifyTelegramInitData, async (req, res) => {
  try {
    const telegramId = (req as any).telegramData.user.id.toString();
    const { answerKeys } = req.body;

    if (!answerKeys || typeof answerKeys !== 'object') {
      return res.status(400).json({ error: 'Javob kalitlari kiritilmagan' });
    }

    // Eng oxirgi test kodini olish
    const lastTest = await prisma.test.findFirst({ orderBy: { testCode: 'desc' } });
    const newTestCode = (lastTest?.testCode || 0) + 1;

    const user = await prisma.user.findUnique({ where: { telegramId } });

    // Test yaratish
    const test = await prisma.test.create({
      data: {
        testCode: newTestCode,
        title: `Test #${newTestCode}`,
        telegramId,
        status: 'active',
      }
    });

    // Savollarni yaratish
    const questions = [];
    for (const [key, correctAnswer] of Object.entries(answerKeys)) {
      const parts = key.split('.');
      const num = parseInt(parts[0]);
      const part = parts.length > 1 ? parts[1] : null;

      // Difficulty: 1-32 = 0 (o'rta), 33-35 = 0.5 (qiyinroq), 36-45 = 1.0 (eng qiyin)
      let difficulty = 0;
      if (num >= 33 && num <= 35) difficulty = 0.5;
      else if (num >= 36 && num <= 45) difficulty = 1.0;

      const question = await prisma.question.create({
        data: {
          testCode: newTestCode,
          num,
          part,
          correctAnswer: correctAnswer as string,
          difficulty,
        }
      });
      questions.push(question);
    }

    // Bot orqali xabar yuborish
    const BOT_TOKEN = process.env.BOT_TOKEN;
    if (BOT_TOKEN) {
      const message = `✅ <b>Test yaratildi!</b>\n\n📋 Test kodi: <b>${newTestCode}</b>\n👤 Yaratuvchi: ${user?.name || 'Noma\'lum'}\n📝 Savollar soni: ${questions.length}\n\nBoshqalar ham shu kod orqali testni ishlashi mumkin.`;
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

    res.json({ success: true, testCode: newTestCode, authorName: user?.name, questionCount: questions.length });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ✅ Testni boshlash - birinchi savolni qaytaradi (theta = 0)
app.post('/api/tests/:testCode/start', verifyTelegramInitData, async (req, res) => {
  try {
    const telegramId = (req as any).telegramData.user.id.toString();
    const testCode = parseInt(req.params.testCode);

    const test = await prisma.test.findUnique({ where: { testCode } });
    if (!test) return res.status(404).json({ error: 'Test topilmadi' });
    if (test.status === 'finished') return res.status(400).json({ error: 'Test yakunlangan' });

    // Foydalanuvchi uchun natija yaratish (agar yo'q bo'lsa)
    let result = await prisma.testResult.findFirst({
      where: { telegramId, testCode }
    });
    if (!result) {
      result = await prisma.testResult.create({
        data: { telegramId, testCode, theta: 0, answers: {} }
      });
    }

    // Theta = 0 ga eng yaqin savolni topish (hali javob berilmagan)
    const answeredKeys = Object.keys(result.answers as object);
    const nextQuestion = await prisma.question.findFirst({
      where: {
        testCode,
        NOT: {
          OR: answeredKeys.map(k => {
            const parts = k.split('.');
            return { num: parseInt(parts[0]), part: parts.length > 1 ? parts[1] : null };
          })
        }
      },
      orderBy: { difficulty: 'asc' }
    });

    if (!nextQuestion) {
      return res.json({ finished: true, message: 'Barcha savollarga javob berildi' });
    }

    res.json({
      question: {
        num: nextQuestion.num,
        part: nextQuestion.part,
        key: nextQuestion.part ? `${nextQuestion.num}.${nextQuestion.part}` : String(nextQuestion.num),
        difficulty: nextQuestion.difficulty,
      },
      theta: result.theta,
      answeredCount: answeredKeys.length,
    });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ✅ Javob yuborish & Theta yangilash (RASCH)
app.post('/api/tests/:testCode/answer', verifyTelegramInitData, async (req, res) => {
  try {
    const telegramId = (req as any).telegramData.user.id.toString();
    const testCode = parseInt(req.params.testCode);
    const { questionKey, userAnswer } = req.body;

    const test = await prisma.test.findUnique({ where: { testCode } });
    if (!test) return res.status(404).json({ error: 'Test topilmadi' });

    // Savolni topish
    const parts = questionKey.split('.');
    const num = parseInt(parts[0]);
    const part = parts.length > 1 ? parts[1] : null;

    const question = await prisma.question.findFirst({
      where: { testCode, num, part }
    });
    if (!question) return res.status(404).json({ error: 'Savol topilmadi' });

    // Natijani olish
    const result = await prisma.testResult.findFirst({
      where: { telegramId, testCode }
    });
    if (!result) return res.status(404).json({ error: 'Test topilmadi' });

    // Javobni tekshirish
    const isCorrect = question.correctAnswer.toUpperCase() === userAnswer.toUpperCase();

    // Theta yangilash (RASCH)
    const newTheta = updateTheta(result.theta, isCorrect, question.difficulty);

    // Javoblarni yangilash
    const answers = result.answers as Record<string, any>;
    answers[questionKey] = { answer: userAnswer, correct: isCorrect };

    await prisma.testResult.update({
      where: { id: result.id },
      data: { theta: newTheta, answers }
    });

    // Stabilizatsiya tekshirish (theta o'zgarishi < 0.05)
    const thetaDiff = Math.abs(newTheta - result.theta);
    const isStable = thetaDiff < 0.05 && Object.keys(answers).length >= 10;

    // Keyingi savolni topish
    let nextQuestion = null;
    if (!isStable) {
      const answeredKeys = Object.keys(answers);
      nextQuestion = await prisma.question.findFirst({
        where: {
          testCode,
          NOT: {
            OR: answeredKeys.map(k => {
              const p = k.split('.');
              return { num: parseInt(p[0]), part: p.length > 1 ? p[1] : null };
            })
          }
        },
        orderBy: { difficulty: 'asc' }
      });
    }

    res.json({
      isCorrect,
      newTheta: Math.round(newTheta * 100) / 100,
      isFinished: isStable || !nextQuestion,
      nextQuestion: nextQuestion ? {
        num: nextQuestion.num,
        part: nextQuestion.part,
        key: nextQuestion.part ? `${nextQuestion.num}.${nextQuestion.part}` : String(nextQuestion.num),
        difficulty: nextQuestion.difficulty,
      } : null,
      answeredCount: Object.keys(answers).length,
    });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ✅ Testni yakunlash (faqat yaratuvchi, kamida 5 kishi)
app.post('/api/tests/:testCode/finalize', async (req, res) => {
  try {
    const { adminTelegramId } = req.body;
    const testCode = parseInt(req.params.testCode);

    const test = await prisma.test.findUnique({ where: { testCode } });
    if (!test) return res.status(404).json({ error: 'Test topilmadi' });

    // Faqat yaratuvchi yakunlay oladi
    if (test.telegramId !== adminTelegramId) {
      return res.status(403).json({ error: 'Bu test sizniki emas!' });
    }

    // Kamida 5 kishi ishlashi kerak
    const participantCount = await prisma.testResult.count({ where: { testCode } });
    if (participantCount < 5) {
      return res.status(400).json({
        error: `Kamida 5 kishi testni ishlashi kerak. Hozir: ${participantCount}`
      });
    }

    // Testni yakunlangan deb belgilash
    await prisma.test.update({
      where: { testCode },
      data: { status: 'finished' }
    });

    // Barcha natijalarni hisoblash
    const results = await prisma.testResult.findMany({
      where: { testCode },
      include: { user: true }
    });

    const finalResults = [];
    for (const r of results) {
      const answers = r.answers as Record<string, any>;
      const correctCount = Object.values(answers).filter((a: any) => a.correct).length;
      const totalQuestions = Object.keys(answers).length;

      // Milliy Sertifikat baholash
      let rawScore = 0;
      for (const [key, val] of Object.entries(answers)) {
        if ((val as any).correct) {
          const num = parseInt(key.split('.')[0]);
          if (num >= 1 && num <= 32) rawScore += 1.0;
          else if (num >= 33 && num <= 35) rawScore += 2.0;
          else if (num >= 36 && num <= 45) rawScore += 2.5;
        }
      }

      const scaledScore = Math.round((rawScore / 88.0) * 100 * 100) / 100;
      const percentage = Math.round((correctCount / Math.max(totalQuestions, 1)) * 100 * 10) / 10;

      let grade = 'F';
      let isCertified = false;
      if (scaledScore >= 90) { grade = 'A+'; isCertified = true; }
      else if (scaledScore >= 80) { grade = 'A'; isCertified = true; }
      else if (scaledScore >= 70) { grade = 'B+'; isCertified = true; }
      else if (scaledScore >= 60) { grade = 'B'; isCertified = true; }
      else if (scaledScore >= 50) { grade = 'C+'; }
      else if (scaledScore >= 40) { grade = 'C'; }

      await prisma.testResult.update({
        where: { id: r.id },
        data: {
          score: correctCount,
          total: totalQuestions,
          rawScore,
          scaledScore,
          percentage,
          grade,
          isCertified,
        }
      });

      finalResults.push({
        name: r.user.name,
        surname: r.user.surname,
        theta: Math.round(r.theta * 100) / 100,
        score: correctCount,
        total: totalQuestions,
        scaledScore,
        percentage,
        grade,
        isCertified,
      });
    }

    // Natijalarni saralash (scaledScore bo'yicha)
    finalResults.sort((a, b) => b.scaledScore - a.scaledScore);

    res.json({ success: true, results: finalResults, participantCount });
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

// ✅ Admin: Reklama yuborish
app.post('/api/admin/broadcast', async (req, res) => {
  try {
    const { message } = req.body;
    const BOT_TOKEN = process.env.BOT_TOKEN;
    if (!BOT_TOKEN) return res.status(400).json({ error: 'BOT_TOKEN not configured' });

    const users = await prisma.user.findMany({ select: { telegramId: true } });
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
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch { /* user blocked bot */ }
    }
    res.json({ success: true, sent });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
